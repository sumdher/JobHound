/**
 * AI Chat page with session-based history and context window tracking.
 * Sessions are identified via ?s=sessionId query param.
 * On first load, redirects to the most recent session or creates one.
 * Streams LLM responses via SSE with meta events for token tracking.
 */

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  listChatSessions,
  createChatSession,
  getChatSessionHistory,
  streamChat,
  streamSummarize,
  estimateTokens,
  type ChatHistoryMessageInput,
  type ChatMessageHistoryItem,
  type ChatSession,
} from "@/lib/api";
import {
  CHAT_DRAFT_UPDATED_EVENT,
  CHAT_SESSIONS_CHANGED_EVENT,
  emitAppEvent,
} from "@/lib/app-events";
import { cn } from "@/lib/utils";

interface Message {
  id?: number;
  clientId: string;
  role: "user" | "assistant";
  content: string;
  parentClientId: string | null;
  childrenIds: string[];
  createdAt?: string;
  streaming?: boolean;
}

interface ConversationTree {
  nodes: Record<string, Message>;
  rootIds: string[];
  selectedChildByParent: Record<string, string>;
}

interface ChatDraft {
  sessionId: string;
  currentSession: ChatSession | null;
  conversation: ConversationTree;
  input: string;
  streaming: boolean;
  summarizing: boolean;
  tokenCount: number;
  maxTokens: number;
  error: string;
}

interface LegacyDraft {
  sessionId: string;
  currentSession: ChatSession | null;
  messages?: Array<Pick<Message, "id" | "role" | "content" | "streaming">>;
  conversation?: ConversationTree;
  input: string;
  streaming: boolean;
  summarizing: boolean;
  tokenCount: number;
  maxTokens: number;
  error: string;
}

const ROOT_PARENT_KEY = "__root__";

function getParentKey(parentClientId: string | null): string {
  return parentClientId ?? ROOT_PARENT_KEY;
}

function createEmptyConversation(): ConversationTree {
  return {
    nodes: {},
    rootIds: [],
    selectedChildByParent: {},
  };
}

function createClientId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cloneConversation(conversation: ConversationTree): ConversationTree {
  return {
    nodes: Object.fromEntries(
      Object.entries(conversation.nodes).map(([clientId, message]) => [
        clientId,
        {
          ...message,
          childrenIds: [...message.childrenIds],
        },
      ])
    ),
    rootIds: [...conversation.rootIds],
    selectedChildByParent: { ...conversation.selectedChildByParent },
  };
}

function upsertConversationMessage(
  conversation: ConversationTree,
  message: Omit<Message, "childrenIds"> & { childrenIds?: string[] },
  options: { select?: boolean } = {}
): ConversationTree {
  const next = cloneConversation(conversation);
  const existing = next.nodes[message.clientId];
  next.nodes[message.clientId] = {
    ...existing,
    ...message,
    childrenIds: existing?.childrenIds ?? [...(message.childrenIds ?? [])],
  } as Message;

  if (message.parentClientId) {
    const parent = next.nodes[message.parentClientId];
    if (parent && !parent.childrenIds.includes(message.clientId)) {
      parent.childrenIds = [...parent.childrenIds, message.clientId];
    }
  } else if (!next.rootIds.includes(message.clientId)) {
    next.rootIds = [...next.rootIds, message.clientId];
  }

  if (options.select ?? true) {
    next.selectedChildByParent[getParentKey(message.parentClientId)] = message.clientId;
  }

  return next;
}

function updateConversationMessage(
  conversation: ConversationTree,
  clientId: string,
  updater: (message: Message) => Message
): ConversationTree {
  const existing = conversation.nodes[clientId];
  if (!existing) return conversation;
  const next = cloneConversation(conversation);
  next.nodes[clientId] = updater(next.nodes[clientId]);
  return next;
}

function removeConversationMessage(conversation: ConversationTree, clientId: string): ConversationTree {
  const existing = conversation.nodes[clientId];
  if (!existing) return conversation;
  const next = cloneConversation(conversation);

  delete next.nodes[clientId];
  delete next.selectedChildByParent[clientId];

  if (existing.parentClientId) {
    const parent = next.nodes[existing.parentClientId];
    if (parent) {
      parent.childrenIds = parent.childrenIds.filter((childId) => childId !== clientId);
      const parentKey = getParentKey(existing.parentClientId);
      if (next.selectedChildByParent[parentKey] === clientId) {
        if (parent.childrenIds.length > 0) next.selectedChildByParent[parentKey] = parent.childrenIds[parent.childrenIds.length - 1];
        else delete next.selectedChildByParent[parentKey];
      }
    }
  } else {
    next.rootIds = next.rootIds.filter((rootId) => rootId !== clientId);
    if (next.selectedChildByParent[ROOT_PARENT_KEY] === clientId) {
      if (next.rootIds.length > 0) next.selectedChildByParent[ROOT_PARENT_KEY] = next.rootIds[next.rootIds.length - 1];
      else delete next.selectedChildByParent[ROOT_PARENT_KEY];
    }
  }

  return next;
}

function getSelectedChildId(conversation: ConversationTree, parentClientId: string | null, childIds: string[]): string | null {
  if (childIds.length === 0) return null;
  const selected = conversation.selectedChildByParent[getParentKey(parentClientId)];
  if (selected && childIds.includes(selected)) return selected;
  return childIds[childIds.length - 1] ?? null;
}

function getVisibleMessageIds(conversation: ConversationTree): string[] {
  const visibleIds: string[] = [];
  let currentId = getSelectedChildId(conversation, null, conversation.rootIds);

  while (currentId) {
    visibleIds.push(currentId);
    const current = conversation.nodes[currentId];
    if (!current) break;
    currentId = getSelectedChildId(conversation, current.clientId, current.childrenIds);
  }

  return visibleIds;
}

function getVisibleMessages(conversation: ConversationTree): Message[] {
  return getVisibleMessageIds(conversation)
    .map((clientId) => conversation.nodes[clientId])
    .filter((message): message is Message => Boolean(message));
}

function getActiveLeafClientId(conversation: ConversationTree): string | null {
  const ids = getVisibleMessageIds(conversation);
  return ids[ids.length - 1] ?? null;
}

function getSiblings(conversation: ConversationTree, clientId: string): string[] {
  const message = conversation.nodes[clientId];
  if (!message) return [];
  return message.parentClientId ? conversation.nodes[message.parentClientId]?.childrenIds ?? [] : conversation.rootIds;
}

function buildConversationFromLegacyMessages(
  messages: Array<Pick<Message, "id" | "role" | "content" | "streaming">>
): ConversationTree {
  let previousClientId: string | null = null;
  return messages.reduce((conversation, message, index) => {
    const clientId = `legacy-${message.id ?? index}`;
    const next = upsertConversationMessage(conversation, {
      id: message.id,
      clientId,
      role: message.role,
      content: message.content,
      parentClientId: previousClientId,
      streaming: message.streaming,
      createdAt: undefined,
    });
    previousClientId = clientId;
    return next;
  }, createEmptyConversation());
}

function buildConversationFromHistory(history: ChatMessageHistoryItem[]): ConversationTree {
  let previousClientId: string | null = null;
  return history.reduce((conversation, message) => {
    const metadata = message.metadata ?? undefined;
    const clientId = metadata?.client_id ?? `db-${message.id}`;
    const parentClientId = metadata && Object.prototype.hasOwnProperty.call(metadata, "parent_client_id")
      ? metadata.parent_client_id ?? null
      : previousClientId;

    const next = upsertConversationMessage(conversation, {
      id: message.id,
      clientId,
      role: message.role as "user" | "assistant",
      content: message.content,
      parentClientId,
      createdAt: message.created_at,
      streaming: false,
    });
    previousClientId = clientId;
    return next;
  }, createEmptyConversation());
}

function normalizeDraft(raw: string): ChatDraft | null {
  try {
    const parsed = JSON.parse(raw) as LegacyDraft;
    return {
      sessionId: parsed.sessionId,
      currentSession: parsed.currentSession,
      conversation:
        parsed.conversation ?? buildConversationFromLegacyMessages(parsed.messages ?? []),
      input: parsed.input ?? "",
      streaming: parsed.streaming ?? false,
      summarizing: parsed.summarizing ?? false,
      tokenCount: parsed.tokenCount ?? 0,
      maxTokens: parsed.maxTokens ?? 8192,
      error: parsed.error ?? "",
    };
  } catch {
    return null;
  }
}

const SUGGESTIONS = [
  "Which companies haven't responded in 2 weeks?",
  "What skills appear most in my applications?",
  "Summarize my application activity this month",
  "What's my response rate so far?",
];

const LOADING_PHRASES = [
  "Consulting the oracle fr fr...",
  "Manifesting an answer...",
  "Doing the math (allegedly)...",
  "Touching grass (digitally)...",
  "Big brain moment loading...",
  "Running vibes check...",
  "Decoding your job hunt arc...",
  "Summoning the thinking hat overlords...",
  "No cap, thinking hard...",
  "Respectfully asking the model...",
  "Slay-mining your applications...",
  "Convinced 1 neural net so far...",
  "Lowkey going through the data...",
  "Reading the runes...",
  "Charting a course through your data...",
  "Testing the winds before we sail...",
  "A brief raid on the problem space...",
  "Forging a cleaner signal...",
  "Letting the dust settle before the verdict...",
  "Scanning the horizon for answers...",
  "Following the northern star of logic...",
  "Sounding the depths of your data...",
  "Plotting a steady course...",
  "Reading the tide before deciding...",
  "Keeping the longship on course...",
  "Mapping unknown waters...",
  "Testing the strength of this idea...",
  "Tracing the fault lines...",
  "Measuring twice, sailing once...",
  "Letting the fog clear...",
  "Anchoring on first principles...",
  "Watching the currents shift...",
  "Taking bearings from the signal...",
  "Crossing open water—stand by...",
  "Quietly sharpening the edge...",
  "Waiting for the right wind...",
  "Marking a clean path forward...",
  "Holding steady through noise...",
  "Finding a truer north...",
  "Applying some Bayesian optimism...",
  "Minimizing regret (and loss functions)...",
  "Gradient descending into clarity...",
  "Reducing uncertainty, one bit at a time...",
  "Searching for a local maximum of insight...",
  "Compiling thoughts, no warnings so far...",
  "Cache miss—thinking from first principles...",
  "Running a quick sanity check...",
  "Normalizing expectations...",
  "Adding a touch of regularization...",
  "Converging… slowly but surely...",
  "Estimating, then overestimating confidence...",
  "Turning data into opinions...",
  "Proof by computation in progress...",
  "Finding signal in polite noise...",
];

// Context window sizes by model keyword
function getContextWindowTokens(): number {
  if (typeof window === "undefined") return 8192;
  try {
    const raw = localStorage.getItem("jobhound_llm_config");
    if (!raw) return 8192;
    const config = JSON.parse(raw) as { model?: string };
    const model = (config.model ?? "").toLowerCase();
    if (model.includes("gpt-4o")) return 128_000;
    if (model.includes("gpt-4")) return 128_000;
    if (model.includes("claude")) return 200_000;
    if (model.includes("llama3") || model.includes("llama-3")) return 8_192;
    if (model.includes("gemma")) return 8_192;
    return 8_192;
  } catch {
    return 8_192;
  }
}

function getLiveContextTokenCount(
  persistedTokenCount: number,
  draftInput: string,
  messages: Message[],
  streaming: boolean,
): number {
  const draftTokens = estimateTokens(draftInput);
  if (!streaming) return persistedTokenCount + draftTokens;

  const assistantMessage = [...messages].reverse().find((msg) => msg.role === "assistant");
  const userMessage = [...messages]
    .reverse()
    .find((msg, index, arr) => msg.role === "user" && arr.slice(0, index).some((m) => m.role === "assistant"));
  const pendingTokens = estimateTokens(userMessage?.content ?? "") + estimateTokens(assistantMessage?.content ?? "");

  return persistedTokenCount + pendingTokens;
}

function getChatDraftStorageKey(sessionId: string): string {
  return `jobhound_chat_draft_${sessionId}`;
}

// ── Markdown renderer ──────────────────────────────────────────────────────────

function inlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={i} className="rounded bg-black/20 px-1 py-0.5 text-xs font-mono">
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tableAlign(cell: string): "left" | "center" | "right" {
  const trimmed = cell.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.endsWith(":")) return "right";
  return "left";
}

function Markdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;
  let listItems: ReactNode[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushList = () => {
    if (listItems.length === 0) return;
    if (listType === "ul")
      nodes.push(<ul key={`ul-${i}`} className="my-1 ml-4 list-disc space-y-0.5">{listItems}</ul>);
    else
      nodes.push(<ol key={`ol-${i}`} className="my-1 ml-4 list-decimal space-y-0.5">{listItems}</ol>);
    listItems = [];
    listType = null;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      flushList();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push(
        <pre key={i} className="my-2 overflow-x-auto rounded-lg bg-black/30 p-3 text-xs font-mono leading-relaxed">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      i++;
      continue;
    } else if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushList();
      const header = parseTableRow(line);
      const alignments = parseTableRow(lines[i + 1]).map(tableAlign);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        body.push(parseTableRow(lines[i]));
        i++;
      }
      nodes.push(
        <div key={`table-${i}`} className="my-3 overflow-x-auto rounded-lg border border-border/50">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-black/10">
              <tr>
                {header.map((cell, index) => (
                  <th
                    key={`th-${index}`}
                    className="border-b border-border/50 px-3 py-2 font-semibold"
                    style={{ textAlign: alignments[index] ?? "left" }}
                  >
                    {inlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={`tr-${rowIndex}`} className="odd:bg-black/5">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`td-${rowIndex}-${cellIndex}`}
                      className="border-t border-border/40 px-3 py-2 align-top"
                      style={{ textAlign: alignments[cellIndex] ?? "left" }}
                    >
                      {inlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (line.startsWith("### ")) {
      flushList();
      nodes.push(<p key={i} className="mt-3 mb-0.5 font-semibold">{inlineMarkdown(line.slice(4))}</p>);
    } else if (line.startsWith("#### ")) {
      flushList();
      nodes.push(<p key={i} className="mt-3 mb-0.5 text-sm font-semibold">{inlineMarkdown(line.slice(5))}</p>);
    } else if (line.startsWith("##### ")) {
      flushList();
      nodes.push(<p key={i} className="mt-3 mb-0.5 text-sm font-medium">{inlineMarkdown(line.slice(6))}</p>);
    } else if (line.startsWith("## ")) {
      flushList();
      nodes.push(<p key={i} className="mt-3 mb-1 text-base font-bold">{inlineMarkdown(line.slice(3))}</p>);
    } else if (line.startsWith("# ")) {
      flushList();
      nodes.push(<p key={i} className="mt-3 mb-1 text-lg font-bold">{inlineMarkdown(line.slice(2))}</p>);
    } else if (/^[-*] /.test(line)) {
      if (listType !== "ul") { flushList(); listType = "ul"; }
      listItems.push(<li key={i}>{inlineMarkdown(line.slice(2))}</li>);
    } else if (/^\d+\. /.test(line)) {
      if (listType !== "ol") { flushList(); listType = "ol"; }
      listItems.push(<li key={i}>{inlineMarkdown(line.replace(/^\d+\. /, ""))}</li>);
    } else if (/^---+$/.test(line.trim())) {
      flushList();
      nodes.push(<hr key={i} className="my-2 border-current opacity-20" />);
    } else if (line.trim() === "") {
      flushList();
      nodes.push(<div key={i} className="h-2" />);
    } else {
      flushList();
      nodes.push(<p key={i} className="leading-relaxed">{inlineMarkdown(line)}</p>);
    }

    i++;
  }

  flushList();
  return <div className="space-y-0.5 text-sm">{nodes}</div>;
}

// ── Context bar ────────────────────────────────────────────────────────────────

function ContextBar({
  tokenCount,
  maxTokens,
  onSummarize,
  summarizing,
}: {
  tokenCount: number;
  maxTokens: number;
  onSummarize: () => void;
  summarizing: boolean;
}) {
  const pct = maxTokens > 0 ? Math.min(100, (tokenCount / maxTokens) * 100) : 0;

  let barColor = "bg-green-500";
  let textColor = "text-green-400";
  if (pct >= 90) { barColor = "bg-red-500"; textColor = "text-red-400"; }
  else if (pct >= 80) { barColor = "bg-orange-500"; textColor = "text-orange-400"; }
  else if (pct >= 60) { barColor = "bg-yellow-500"; textColor = "text-yellow-400"; }

  const formatK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);

  return (
    <div className="mb-2 flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all duration-500", barColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className={cn("shrink-0 text-xs font-medium tabular-nums", textColor)}>
        ~{formatK(tokenCount)} / {formatK(maxTokens)} tokens
      </span>
      {pct >= 80 && (
        <button
          onClick={onSummarize}
          disabled={summarizing}
          className="shrink-0 rounded-md bg-orange-500/20 px-2 py-1 text-xs font-medium text-orange-400 hover:bg-orange-500/30 disabled:opacity-50 transition-colors"
        >
          {summarizing ? "Summarizing…" : "Summarize & Continue"}
        </button>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get("s");

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [conversation, setConversation] = useState<ConversationTree>(createEmptyConversation());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [loadingPhrase, setLoadingPhrase] = useState("");
  const [error, setError] = useState("");
  const [tokenCount, setTokenCount] = useState(0);
  const [maxTokens, setMaxTokens] = useState(8192);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const currentSessionRef = useRef<ChatSession | null>(currentSession);
  const conversationRef = useRef<ConversationTree>(conversation);
  const inputRefState = useRef(input);
  const streamingRef = useRef(streaming);
  const summarizingRef = useRef(summarizing);
  const tokenCountRef = useRef(tokenCount);
  const maxTokensRef = useRef(maxTokens);
  const errorRef = useRef(error);
  const messages = useMemo(() => getVisibleMessages(conversation), [conversation]);
  const isEmptySession = (currentSession?.message_count ?? 0) === 0 && Object.keys(conversation.nodes).length === 0;
  const liveTokenCount = getLiveContextTokenCount(tokenCount, input, messages, streaming);

  const persistDraft = useCallback((draft: ChatDraft) => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(getChatDraftStorageKey(draft.sessionId), JSON.stringify(draft));
    emitAppEvent(CHAT_DRAFT_UPDATED_EVENT, draft);
  }, []);

  const persistCurrentState = useCallback((overrides: Partial<ChatDraft> = {}) => {
    const activeSessionId = overrides.sessionId ?? sessionIdRef.current;
    if (!activeSessionId) return;

    persistDraft({
      sessionId: activeSessionId,
      currentSession:
        overrides.currentSession !== undefined ? overrides.currentSession : currentSessionRef.current,
      conversation: overrides.conversation ?? conversationRef.current,
      input: overrides.input ?? inputRefState.current,
      streaming: overrides.streaming ?? streamingRef.current,
      summarizing: overrides.summarizing ?? summarizingRef.current,
      tokenCount: overrides.tokenCount ?? tokenCountRef.current,
      maxTokens: overrides.maxTokens ?? maxTokensRef.current,
      error: overrides.error ?? errorRef.current,
    });
  }, [persistDraft]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  useEffect(() => {
    inputRefState.current = input;
  }, [input]);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  useEffect(() => {
    summarizingRef.current = summarizing;
  }, [summarizing]);

  useEffect(() => {
    tokenCountRef.current = tokenCount;
  }, [tokenCount]);

  useEffect(() => {
    maxTokensRef.current = maxTokens;
  }, [maxTokens]);

  useEffect(() => {
    errorRef.current = error;
  }, [error]);

  // Auto-grow textarea
  const adjustHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Initialize session from URL or redirect to latest/new session
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (sessionIdParam) {
        let draft: ChatDraft | null = null;
        if (typeof window !== "undefined") {
          const raw = window.sessionStorage.getItem(getChatDraftStorageKey(sessionIdParam));
          if (raw) {
            draft = normalizeDraft(raw);
            if (draft) {
              sessionIdRef.current = draft.sessionId;
              currentSessionRef.current = draft.currentSession;
              conversationRef.current = draft.conversation;
              inputRefState.current = draft.input;
              streamingRef.current = draft.streaming;
              summarizingRef.current = draft.summarizing;
              tokenCountRef.current = draft.tokenCount;
              maxTokensRef.current = draft.maxTokens;
              errorRef.current = draft.error;
              setCurrentSession(draft.currentSession);
              setSessionId(draft.sessionId);
              setConversation(draft.conversation);
              setInput(draft.input);
              setStreaming(draft.streaming);
              setSummarizing(draft.summarizing);
              setTokenCount(draft.tokenCount);
              setMaxTokens(draft.maxTokens);
              setError(draft.error);
            } else {
              window.sessionStorage.removeItem(getChatDraftStorageKey(sessionIdParam));
            }
          }
        }

        // Load history for the given session
        setLoading(true);
        try {
          const [history, sessions] = await Promise.all([
            getChatSessionHistory(sessionIdParam),
            listChatSessions(),
          ]);
          if (cancelled) return;

          const sess = sessions.find((s) => s.id === sessionIdParam) ?? null;
          sessionIdRef.current = sessionIdParam;
          currentSessionRef.current = sess;
          setCurrentSession(sess);
          setSessionId(sessionIdParam);

          const ctxTokens = getContextWindowTokens();
          setMaxTokens(sess?.max_tokens ?? ctxTokens);
          setTokenCount(sess?.token_count ?? 0);

          if (!draft?.streaming && !draft?.summarizing) {
            const restoredConversation = buildConversationFromHistory(history);
            conversationRef.current = restoredConversation;
            setConversation(restoredConversation);
            setInput(draft?.input ?? "");
            setError("");
          } else {
            setCurrentSession((prev) => sess ?? prev);
            setTokenCount((prev) => Math.max(prev, sess?.token_count ?? 0));
          }
        } catch {
          // non-critical, just show empty state
        } finally {
          if (!cancelled) setLoading(false);
        }
      } else {
        // No session param — find or create
        try {
          const sessions = await listChatSessions();
          if (cancelled) return;
          if (sessions.length > 0) {
            router.replace(`/chat?s=${sessions[0].id}`);
          } else {
            const newSession = await createChatSession();
            if (!cancelled) router.replace(`/chat?s=${newSession.id}`);
          }
        } catch {
          if (!cancelled) setLoading(false);
        }
      }
    };

    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdParam]);

  useEffect(() => {
    const handleDraftUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<ChatDraft | { sessionId: string; cleared: true }>;
      if (!sessionIdParam || !customEvent.detail || customEvent.detail.sessionId !== sessionIdParam) return;
      if ("cleared" in customEvent.detail) return;
      const draft = customEvent.detail;
      sessionIdRef.current = draft.sessionId;
      currentSessionRef.current = draft.currentSession;
      conversationRef.current = draft.conversation;
      inputRefState.current = draft.input;
      streamingRef.current = draft.streaming;
      summarizingRef.current = draft.summarizing;
      tokenCountRef.current = draft.tokenCount;
      maxTokensRef.current = draft.maxTokens;
      errorRef.current = draft.error;
      setCurrentSession(draft.currentSession);
      setSessionId(draft.sessionId);
      setConversation(draft.conversation);
      setInput(draft.input);
      setStreaming(draft.streaming);
      setSummarizing(draft.summarizing);
      setTokenCount(draft.tokenCount);
      setMaxTokens(draft.maxTokens);
      setError(draft.error);
    };
    window.addEventListener(CHAT_DRAFT_UPDATED_EVENT, handleDraftUpdated);
    return () => window.removeEventListener(CHAT_DRAFT_UPDATED_EVENT, handleDraftUpdated);
  }, [sessionIdParam]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // Cycle loading phrases while streaming
  useEffect(() => {
    if (!streaming) { setLoadingPhrase(""); return; }
    const pick = () =>
      setLoadingPhrase(LOADING_PHRASES[Math.floor(Math.random() * LOADING_PHRASES.length)]);
    pick();
    const id = setInterval(pick, 2500);
    return () => clearInterval(id);
  }, [streaming]);

  const streamAssistantReply = useCallback(async ({
    message,
    history,
    nextConversation,
    assistantClientId,
    persistUserMessage,
    inputValue,
    userParentClientId,
    assistantParentClientId,
  }: {
    message: string;
    history: ChatHistoryMessageInput[];
    nextConversation: ConversationTree;
    assistantClientId: string;
    persistUserMessage: boolean;
    inputValue: string;
    userParentClientId?: string | null;
    assistantParentClientId: string;
  }) => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    errorRef.current = "";
    streamingRef.current = true;
    inputRefState.current = inputValue;
    conversationRef.current = nextConversation;

    setError("");
    setStreaming(true);
    setInput(inputValue);
    setConversation(nextConversation);
    persistCurrentState({
      conversation: nextConversation,
      input: inputValue,
      streaming: true,
      summarizing: false,
      error: "",
    });

    try {
      await streamChat(
        message,
        (token) => {
          const updatedConversation = updateConversationMessage(conversationRef.current, assistantClientId, (assistantMessage) => ({
            ...assistantMessage,
            content: assistantMessage.content + token,
          }));
          conversationRef.current = updatedConversation;
          setConversation(updatedConversation);
          persistCurrentState({
            conversation: updatedConversation,
            streaming: true,
            summarizing: false,
            error: "",
          });
        },
        () => {
          const updatedConversation = updateConversationMessage(conversationRef.current, assistantClientId, (assistantMessage) => ({
            ...assistantMessage,
            streaming: false,
          }));
          conversationRef.current = updatedConversation;
          streamingRef.current = false;
          setConversation(updatedConversation);
          setStreaming(false);
          persistCurrentState({
            conversation: updatedConversation,
            streaming: false,
            summarizing: false,
            error: "",
          });
        },
        async (meta) => {
          tokenCountRef.current = meta.token_count;
          setTokenCount(meta.token_count);
          try {
            const sessions = await listChatSessions();
            const sess = sessions.find((item) => item.id === meta.session_id) ?? null;
            currentSessionRef.current = sess;
            setCurrentSession(sess);
            if (sess?.max_tokens) {
              maxTokensRef.current = sess.max_tokens;
              setMaxTokens(sess.max_tokens);
            }
            emitAppEvent(CHAT_SESSIONS_CHANGED_EVENT);
            persistCurrentState({
              currentSession: sess,
              tokenCount: meta.token_count,
              maxTokens: sess?.max_tokens ?? maxTokensRef.current,
              streaming: false,
              summarizing: false,
              error: "",
            });
          } catch {
            // non-critical
          }
        },
        (err) => {
          errorRef.current = err;
          streamingRef.current = false;
          setError(err);
          setStreaming(false);
          const updatedConversation = updateConversationMessage(conversationRef.current, assistantClientId, (assistantMessage) => ({
            ...assistantMessage,
            content: assistantMessage.content || "Sorry, something went wrong. Please try again.",
            streaming: false,
          }));
          conversationRef.current = updatedConversation;
          setConversation(updatedConversation);
          persistCurrentState({
            conversation: updatedConversation,
            streaming: false,
            summarizing: false,
            error: err,
          });
        },
        {
          sessionId: activeSessionId,
          signal: controller.signal,
          history,
          persistUserMessage,
          ...(persistUserMessage
            ? {
                userMessageMetadata: {
                  client_id: assistantParentClientId,
                  parent_client_id: userParentClientId ?? null,
                },
              }
            : {}),
          assistantMessageMetadata: {
            client_id: assistantClientId,
            parent_client_id: assistantParentClientId,
          },
        }
      );
    } catch (e) {
      const messageText = e instanceof Error ? e.message : "Stream failed";
      errorRef.current = messageText;
      streamingRef.current = false;
      setError(messageText);
      setStreaming(false);
      persistCurrentState({
        streaming: false,
        summarizing: false,
        error: messageText,
      });
    }
  }, [persistCurrentState]);

  const handleSend = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || streaming || summarizing || !sessionId) return;

    const currentConversation = conversationRef.current;
    const parentClientId = getActiveLeafClientId(currentConversation);
    const userClientId = createClientId("user");
    const assistantClientId = createClientId("assistant");
    const history = getVisibleMessages(currentConversation).map((item) => ({
      role: item.role,
      content: item.content,
    }));

    let nextConversation = upsertConversationMessage(currentConversation, {
      clientId: userClientId,
      role: "user",
      content: msg,
      parentClientId,
      streaming: false,
    });
    nextConversation = upsertConversationMessage(nextConversation, {
      clientId: assistantClientId,
      role: "assistant",
      content: "",
      parentClientId: userClientId,
      streaming: true,
    });

    if (inputRef.current) inputRef.current.style.height = "auto";

    await streamAssistantReply({
      message: msg,
      history,
      nextConversation,
      assistantClientId,
      persistUserMessage: true,
      inputValue: "",
      userParentClientId: parentClientId,
      assistantParentClientId: userClientId,
    });
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamingRef.current = false;
    setStreaming(false);
    const activeStreamingId = (Object.values(conversationRef.current.nodes) as Message[]).find(
      (message) => message.streaming,
    )?.clientId;
    if (activeStreamingId) {
      const updatedConversation = updateConversationMessage(conversationRef.current, activeStreamingId, (message) => ({
        ...message,
        streaming: false,
      }));
      conversationRef.current = updatedConversation;
      setConversation(updatedConversation);
      persistCurrentState({
        conversation: updatedConversation,
        streaming: false,
        summarizing: false,
        error: errorRef.current,
      });
    }
  };

  const handleNewChat = async () => {
    try {
      const newSession = await createChatSession();
      emitAppEvent(CHAT_SESSIONS_CHANGED_EVENT);
      router.push(`/chat?s=${newSession.id}`);
    } catch {
      setError("Failed to create new session");
    }
  };

  const handleSummarize = async () => {
    if (!sessionId || summarizing || streaming) return;
    setSummarizing(true);
    setError("");
    summarizingRef.current = true;
    errorRef.current = "";

    // Add placeholder summarizing message
    const placeholderClientId = createClientId("summary");
    const updatedWithPlaceholder = upsertConversationMessage(conversationRef.current, {
      clientId: placeholderClientId,
      role: "assistant",
      content: "",
      parentClientId: getActiveLeafClientId(conversationRef.current),
      streaming: true,
    });
    conversationRef.current = updatedWithPlaceholder;
    summarizingRef.current = true;
    setConversation(updatedWithPlaceholder);
    persistCurrentState({
      conversation: updatedWithPlaceholder,
      streaming: false,
      summarizing: true,
      error: "",
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamSummarize(
        sessionId,
        (_token) => {
          // We don't show tokens during summarize — we reload history after
        },
        async () => {
          // Reload history and token count after summarize completes
          try {
            const [history, sessions] = await Promise.all([
              getChatSessionHistory(sessionId),
              listChatSessions(),
            ]);
            const sess = sessions.find((s) => s.id === sessionId) ?? null;
            if (sess) {
              tokenCountRef.current = sess.token_count;
              maxTokensRef.current = sess.max_tokens;
              currentSessionRef.current = sess;
              setTokenCount(sess.token_count);
              setMaxTokens(sess.max_tokens);
              setCurrentSession(sess);
            }
            const restoredConversation = buildConversationFromHistory(history);
            conversationRef.current = restoredConversation;
            summarizingRef.current = false;
            setConversation(restoredConversation);
            persistCurrentState({
              currentSession: sess,
              conversation: restoredConversation,
              streaming: false,
              summarizing: false,
              tokenCount: sess?.token_count ?? tokenCountRef.current,
              maxTokens: sess?.max_tokens ?? maxTokensRef.current,
              error: "",
            });
            emitAppEvent(CHAT_SESSIONS_CHANGED_EVENT);
          } catch {
            // Remove placeholder on failure
            const restoredConversation = removeConversationMessage(conversationRef.current, placeholderClientId);
            conversationRef.current = restoredConversation;
            setConversation(restoredConversation);
          }
          setSummarizing(false);
        },
        (err) => {
          errorRef.current = err;
          summarizingRef.current = false;
          setError(err);
          setSummarizing(false);
          const updatedConversation = removeConversationMessage(conversationRef.current, placeholderClientId);
          conversationRef.current = updatedConversation;
          persistCurrentState({
            conversation: updatedConversation,
            streaming: false,
            summarizing: false,
            error: err,
          });
          setConversation(updatedConversation);
        },
        controller.signal,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Summarize failed";
      errorRef.current = message;
      summarizingRef.current = false;
      setError(message);
      setSummarizing(false);
      const updatedConversation = removeConversationMessage(conversationRef.current, placeholderClientId);
      conversationRef.current = updatedConversation;
      setConversation(updatedConversation);
      persistCurrentState({
        conversation: updatedConversation,
        streaming: false,
        summarizing: false,
        error: message,
      });
    }
  };

  const handleCopyAssistantMessage = async (message: Message) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.clientId);
      window.setTimeout(() => {
        setCopiedMessageId((current: string | null) => (current === message.clientId ? null : current));
      }, 1500);
    } catch {
      setError("Failed to copy message to clipboard.");
    }
  };

  const handleRetryAssistantMessage = async (message: Message) => {
    if (streaming || summarizing || !sessionId) return;
    const parentMessage = message.parentClientId ? conversationRef.current.nodes[message.parentClientId] : null;
    if (!parentMessage || parentMessage.role !== "user") return;

    const visibleMessages = getVisibleMessages(conversationRef.current);
    const parentIndex = visibleMessages.findIndex((item) => item.clientId === parentMessage.clientId);
    if (parentIndex === -1) return;

    const assistantClientId = createClientId("assistant");
    const history = visibleMessages.slice(0, parentIndex).map((item) => ({ role: item.role, content: item.content }));
    const nextConversation = upsertConversationMessage(conversationRef.current, {
      clientId: assistantClientId,
      role: "assistant",
      content: "",
      parentClientId: parentMessage.clientId,
      streaming: true,
    });

    await streamAssistantReply({
      message: parentMessage.content,
      history,
      nextConversation,
      assistantClientId,
      persistUserMessage: false,
      inputValue: inputRefState.current,
      assistantParentClientId: parentMessage.clientId,
    });
  };

  const handleStartEditingMessage = (message: Message) => {
    setEditingMessageId(message.clientId);
    setEditingContent(message.content);
  };

  const handleCancelEditingMessage = () => {
    setEditingMessageId(null);
    setEditingContent("");
  };

  const handleSaveEditedMessage = async () => {
    if (!editingMessageId || streaming || summarizing || !sessionId) return;
    const nextContent = editingContent.trim();
    if (!nextContent) return;

    const targetMessage = conversationRef.current.nodes[editingMessageId];
    if (!targetMessage || targetMessage.role !== "user") return;

    const visibleMessages = getVisibleMessages(conversationRef.current);
    const targetIndex = visibleMessages.findIndex((item) => item.clientId === editingMessageId);
    if (targetIndex === -1) return;

    const userClientId = createClientId("user");
    const assistantClientId = createClientId("assistant");
    const history = visibleMessages.slice(0, targetIndex).map((item) => ({ role: item.role, content: item.content }));

    let nextConversation = upsertConversationMessage(conversationRef.current, {
      clientId: userClientId,
      role: "user",
      content: nextContent,
      parentClientId: targetMessage.parentClientId,
      streaming: false,
    });
    nextConversation = upsertConversationMessage(nextConversation, {
      clientId: assistantClientId,
      role: "assistant",
      content: "",
      parentClientId: userClientId,
      streaming: true,
    });

    setEditingMessageId(null);
    setEditingContent("");

    await streamAssistantReply({
      message: nextContent,
      history,
      nextConversation,
      assistantClientId,
      persistUserMessage: true,
      inputValue: inputRefState.current,
      userParentClientId: targetMessage.parentClientId,
      assistantParentClientId: userClientId,
    });
  };

  const handleNavigateSiblings = (message: Message, direction: -1 | 1) => {
    const siblingIds = getSiblings(conversationRef.current, message.clientId);
    if (siblingIds.length <= 1) return;
    const currentIndex = siblingIds.indexOf(message.clientId);
    if (currentIndex === -1) return;

    const nextIndex = (currentIndex + direction + siblingIds.length) % siblingIds.length;
    const parentKey = getParentKey(message.parentClientId);
    const nextConversation = cloneConversation(conversationRef.current);
    nextConversation.selectedChildByParent[parentKey] = siblingIds[nextIndex];
    conversationRef.current = nextConversation;
    setConversation(nextConversation);

    if (editingMessageId === message.clientId) {
      setEditingMessageId(null);
      setEditingContent("");
    }

    persistCurrentState({
      conversation: nextConversation,
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-4 py-6 md:px-6">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const sessionTitle = currentSession?.title ?? "AI Chat";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 px-4 pb-3 pt-4 md:px-6 md:pt-6">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold">{sessionTitle}</h1>
            <p className="text-sm text-muted-foreground">
              Ask questions about your job applications
            </p>
          </div>
          <button
            onClick={handleNewChat}
            disabled={isEmptySession}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            + New Chat
          </button>
        </div>

        {/* Context bar — only show once we have a session with messages */}
        {sessionId && (messages.length > 0 || tokenCount > 0 || input.trim().length > 0) && (
          <ContextBar
            tokenCount={liveTokenCount}
            maxTokens={maxTokens}
            onSummarize={handleSummarize}
            summarizing={summarizing}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 px-4 pb-4 md:px-6 md:pb-6">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {/* Messages */}
          <div
            ref={messagesContainerRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
          >
            {messages.length === 0 && !summarizing ? (
              <div className="flex h-full flex-col items-center justify-center gap-6">
                <div className="text-center">
                  <div className="mb-2 text-4xl">💬</div>
                  <h2 className="text-lg font-semibold">Start a conversation</h2>
                  <p className="text-sm text-muted-foreground">
                    Ask anything about your job applications
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => handleSend(suggestion)}
                      className="rounded-lg border border-border bg-secondary px-4 py-2 text-left text-sm transition-colors hover:bg-accent"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {summarizing && messages.every((m: Message) => !m.streaming) && (
                  <div className="flex justify-center py-4">
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-4 py-2 text-sm text-muted-foreground">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      Summarizing conversation…
                    </div>
                  </div>
                )}
                {messages.map((msg: Message) => {
                  const siblingIds = getSiblings(conversation, msg.clientId);
                  const siblingIndex = siblingIds.indexOf(msg.clientId);
                  const isEditing = editingMessageId === msg.clientId;

                  return (
                    <div
                      key={msg.clientId}
                      className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] rounded-2xl px-4 py-2.5 sm:max-w-[80%]",
                          msg.role === "user"
                            ? "bg-primary text-sm text-primary-foreground"
                            : "bg-secondary text-foreground"
                        )}
                      >
                        {msg.role === "assistant" ? (
                          msg.content ? (
                            <>
                              <Markdown content={msg.content} />
                              {msg.streaming && (
                                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current" />
                              )}
                            </>
                          ) : (
                            <span className="flex gap-1 px-1 py-1">
                              <span className="animate-bounce text-lg leading-none">·</span>
                              <span className="animate-bounce text-lg leading-none [animation-delay:0.1s]">·</span>
                              <span className="animate-bounce text-lg leading-none [animation-delay:0.2s]">·</span>
                            </span>
                          )
                        ) : isEditing ? (
                          <div className="space-y-3">
                            <textarea
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              rows={3}
                              className="w-full resize-y rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-primary-foreground placeholder:text-primary-foreground/70 focus:outline-none focus:ring-2 focus:ring-white/40"
                            />
                            <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                              <button
                                onClick={handleCancelEditingMessage}
                                className="rounded-md border border-white/25 px-2.5 py-1 text-primary-foreground/90 transition-colors hover:bg-white/10"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={handleSaveEditedMessage}
                                disabled={!editingContent.trim() || streaming || summarizing}
                                className="rounded-md bg-white/15 px-2.5 py-1 font-medium text-primary-foreground transition-colors hover:bg-white/20 disabled:opacity-50"
                              >
                                Save & restart
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm">{msg.content}</span>
                        )}

                        {!msg.streaming && (
                          <div className={cn("mt-3 flex flex-wrap items-center gap-2 text-xs", msg.role === "user" ? "text-primary-foreground/85" : "text-muted-foreground")}>
                            {msg.role === "assistant" && msg.content && (
                              <>
                                <button
                                  onClick={() => handleCopyAssistantMessage(msg)}
                                  className="rounded-md border border-current/20 px-2 py-1 transition-colors hover:bg-black/5"
                                >
                                  {copiedMessageId === msg.clientId ? "Copied" : "Copy"}
                                </button>
                                <button
                                  onClick={() => handleRetryAssistantMessage(msg)}
                                  disabled={streaming || summarizing}
                                  className="rounded-md border border-current/20 px-2 py-1 transition-colors hover:bg-black/5 disabled:opacity-50"
                                >
                                  Try again
                                </button>
                              </>
                            )}

                            {msg.role === "user" && !isEditing && (
                              <button
                                onClick={() => handleStartEditingMessage(msg)}
                                disabled={streaming || summarizing}
                                className="rounded-md border border-current/20 px-2 py-1 transition-colors hover:bg-white/10 disabled:opacity-50"
                              >
                                Edit
                              </button>
                            )}

                            {siblingIds.length > 1 && (
                              <div className="ml-auto inline-flex items-center gap-1 rounded-full border border-current/20 px-1 py-1">
                                <button
                                  onClick={() => handleNavigateSiblings(msg, -1)}
                                  className="rounded-full px-2 py-0.5 transition-colors hover:bg-black/5"
                                  aria-label="Previous branch"
                                >
                                  &lt;
                                </button>
                                <span className="min-w-[3rem] text-center tabular-nums">
                                  {siblingIndex + 1}/{siblingIds.length}
                                </span>
                                <button
                                  onClick={() => handleNavigateSiblings(msg, 1)}
                                  className="rounded-full px-2 py-0.5 transition-colors hover:bg-black/5"
                                  aria-label="Next branch"
                                >
                                  &gt;
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border bg-background/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur sm:px-4">
            {/* Error */}
            {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

            {/* Loading phrase */}
            {streaming && loadingPhrase && (
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="italic">{loadingPhrase}</span>
              </div>
            )}

            {/* Input */}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  const next = e.target.value;
                  inputRefState.current = next;
                  setInput(next);
                  if (sessionId) {
                    persistCurrentState({ input: next });
                  }
                  adjustHeight();
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your applications… (Shift+Enter for newline)"
                disabled={streaming || summarizing || !sessionId}
                rows={1}
                style={{ maxHeight: "180px" }}
                className="flex-1 resize-none overflow-y-auto rounded-xl border border-border bg-input px-4 py-3 text-sm leading-relaxed placeholder:text-muted-foreground transition-[height] focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              {streaming ? (
                <button
                  onClick={handleStop}
                  title="Stop generation"
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-secondary px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || summarizing || !sessionId}
                  className="shrink-0 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
