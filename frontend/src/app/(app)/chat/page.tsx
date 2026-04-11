/**
 * AI Chat page with session-based history and context window tracking.
 * Sessions are identified via ?s=sessionId query param.
 * On first load, redirects to the most recent session or creates one.
 * Streams LLM responses via SSE with meta events for token tracking.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  listChatSessions,
  createChatSession,
  getChatSessionHistory,
  streamChat,
  streamSummarize,
  estimateTokens,
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
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface ChatDraft {
  sessionId: string;
  currentSession: ChatSession | null;
  messages: Message[];
  input: string;
  streaming: boolean;
  summarizing: boolean;
  tokenCount: number;
  maxTokens: number;
  error: string;
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

function inlineMarkdown(text: string): React.ReactNode[] {
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
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let listItems: React.ReactNode[] = [];
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [loadingPhrase, setLoadingPhrase] = useState("");
  const [error, setError] = useState("");
  const [tokenCount, setTokenCount] = useState(0);
  const [maxTokens, setMaxTokens] = useState(8192);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const currentSessionRef = useRef<ChatSession | null>(currentSession);
  const messagesRef = useRef<Message[]>(messages);
  const inputRefState = useRef(input);
  const streamingRef = useRef(streaming);
  const summarizingRef = useRef(summarizing);
  const tokenCountRef = useRef(tokenCount);
  const maxTokensRef = useRef(maxTokens);
  const errorRef = useRef(error);
  const isEmptySession = currentSession?.message_count === 0;
  const liveTokenCount = getLiveContextTokenCount(tokenCount, input, messages, streaming);

  const persistDraft = useCallback((draft: ChatDraft) => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(getChatDraftStorageKey(draft.sessionId), JSON.stringify(draft));
    emitAppEvent(CHAT_DRAFT_UPDATED_EVENT, draft);
  }, []);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
            try {
              draft = JSON.parse(raw) as ChatDraft;
              sessionIdRef.current = draft.sessionId;
              currentSessionRef.current = draft.currentSession;
              messagesRef.current = draft.messages;
              inputRefState.current = draft.input;
              streamingRef.current = draft.streaming;
              summarizingRef.current = draft.summarizing;
              tokenCountRef.current = draft.tokenCount;
              maxTokensRef.current = draft.maxTokens;
              errorRef.current = draft.error;
              setCurrentSession(draft.currentSession);
              setSessionId(draft.sessionId);
              setMessages(draft.messages);
              setInput(draft.input);
              setStreaming(draft.streaming);
              setSummarizing(draft.summarizing);
              setTokenCount(draft.tokenCount);
              setMaxTokens(draft.maxTokens);
              setError(draft.error);
            } catch {
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
            setMessages(
              history.map((m) => ({
                id: m.id,
                role: m.role as "user" | "assistant",
                content: m.content,
              }))
            );
            messagesRef.current = history.map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
            }));
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
      messagesRef.current = draft.messages;
      inputRefState.current = draft.input;
      streamingRef.current = draft.streaming;
      summarizingRef.current = draft.summarizing;
      tokenCountRef.current = draft.tokenCount;
      maxTokensRef.current = draft.maxTokens;
      errorRef.current = draft.error;
      setCurrentSession(draft.currentSession);
      setSessionId(draft.sessionId);
      setMessages(draft.messages);
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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

  const handleSend = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || streaming || summarizing || !sessionId) return;

    setInput("");
    setError("");
    errorRef.current = "";
    if (inputRef.current) inputRef.current.style.height = "auto";

    const userMessage: Message = { role: "user", content: msg };
    const assistantMessage: Message = { role: "assistant", content: "", streaming: true };
    const nextMessages = [...messagesRef.current, userMessage, assistantMessage];

    inputRefState.current = "";
    messagesRef.current = nextMessages;
    streamingRef.current = true;
    setMessages(nextMessages);
    setStreaming(true);
    persistDraft({
      sessionId,
      currentSession: currentSessionRef.current,
      messages: nextMessages,
      input: "",
      streaming: true,
      summarizing: false,
      tokenCount: tokenCountRef.current,
      maxTokens: maxTokensRef.current,
      error: "",
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        msg,
        (token) => {
          const updated = [...messagesRef.current];
          const last = updated[updated.length - 1];
          if (last?.streaming) {
            updated[updated.length - 1] = { ...last, content: last.content + token };
          }
          messagesRef.current = updated;
          persistDraft({
            sessionId,
            currentSession: currentSessionRef.current,
            messages: updated,
            input: inputRefState.current,
            streaming: true,
            summarizing: false,
            tokenCount: tokenCountRef.current,
            maxTokens: maxTokensRef.current,
            error: "",
          });
          setMessages(updated);
        },
        () => {
          const updated = [...messagesRef.current];
          const last = updated[updated.length - 1];
          if (last?.streaming) {
            updated[updated.length - 1] = { ...last, streaming: false };
          }
          messagesRef.current = updated;
          streamingRef.current = false;
          persistDraft({
            sessionId,
            currentSession: currentSessionRef.current,
            messages: updated,
            input: inputRefState.current,
            streaming: false,
            summarizing: false,
            tokenCount: tokenCountRef.current,
            maxTokens: maxTokensRef.current,
            error: "",
          });
          setMessages(updated);
          setStreaming(false);
        },
        async (meta) => {
          tokenCountRef.current = meta.token_count;
          setTokenCount(meta.token_count);
          try {
            const sessions = await listChatSessions();
            const sess = sessions.find((s) => s.id === meta.session_id) ?? null;
            currentSessionRef.current = sess;
            setCurrentSession(sess);
            emitAppEvent(CHAT_SESSIONS_CHANGED_EVENT);
            persistDraft({
              sessionId,
              currentSession: sess,
              messages: messagesRef.current,
              input: inputRefState.current,
              streaming: false,
              summarizing: false,
              tokenCount: meta.token_count,
              maxTokens: sess?.max_tokens ?? maxTokensRef.current,
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
          const updated = [...messagesRef.current];
          const last = updated[updated.length - 1];
          if (last?.streaming) {
            updated[updated.length - 1] = {
              ...last,
              content: "Sorry, something went wrong. Please try again.",
              streaming: false,
            };
          }
          messagesRef.current = updated;
          persistDraft({
            sessionId,
            currentSession: currentSessionRef.current,
            messages: updated,
            input: inputRefState.current,
            streaming: false,
            summarizing: false,
            tokenCount: tokenCountRef.current,
            maxTokens: maxTokensRef.current,
            error: err,
          });
          setMessages(updated);
        },
        sessionId,
        controller.signal,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Stream failed";
      errorRef.current = message;
      streamingRef.current = false;
      setError(message);
      setStreaming(false);
      persistDraft({
        sessionId,
        currentSession: currentSessionRef.current,
        messages: messagesRef.current,
        input: inputRefState.current,
        streaming: false,
        summarizing: false,
        tokenCount: tokenCountRef.current,
        maxTokens: maxTokensRef.current,
        error: message,
      });
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamingRef.current = false;
    setStreaming(false);
    const updated = [...messagesRef.current];
    const last = updated[updated.length - 1];
    if (last?.streaming) {
      updated[updated.length - 1] = { ...last, streaming: false };
    }
    messagesRef.current = updated;
    setMessages(updated);
    if (sessionId) {
      persistDraft({
        sessionId,
        currentSession: currentSessionRef.current,
        messages: updated,
        input: inputRefState.current,
        streaming: false,
        summarizing: false,
        tokenCount: tokenCountRef.current,
        maxTokens: maxTokensRef.current,
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
    const placeholderMsg: Message = { role: "assistant", content: "", streaming: true };
    const updatedWithPlaceholder = [...messagesRef.current, placeholderMsg];
    messagesRef.current = updatedWithPlaceholder;
    summarizingRef.current = true;
    setMessages(updatedWithPlaceholder);
    persistDraft({
      sessionId,
      currentSession: currentSessionRef.current,
      messages: updatedWithPlaceholder,
      input: inputRefState.current,
      streaming: false,
      summarizing: true,
      tokenCount: tokenCountRef.current,
      maxTokens: maxTokensRef.current,
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
            const restoredMessages = history.map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
            }));
            messagesRef.current = restoredMessages;
            summarizingRef.current = false;
            setMessages(restoredMessages);
            persistDraft({
              sessionId,
              currentSession: sess,
              messages: restoredMessages,
              input: inputRefState.current,
              streaming: false,
              summarizing: false,
              tokenCount: sess?.token_count ?? tokenCountRef.current,
              maxTokens: sess?.max_tokens ?? maxTokensRef.current,
              error: "",
            });
            emitAppEvent(CHAT_SESSIONS_CHANGED_EVENT);
          } catch {
            // Remove placeholder on failure
            const restored = messagesRef.current.filter((m) => !m.streaming);
            messagesRef.current = restored;
            setMessages(restored);
          }
          setSummarizing(false);
        },
        (err) => {
          errorRef.current = err;
          summarizingRef.current = false;
          setError(err);
          setSummarizing(false);
          const updated = messagesRef.current.filter((m) => !m.streaming);
          messagesRef.current = updated;
          persistDraft({
            sessionId,
            currentSession: currentSessionRef.current,
            messages: updated,
            input: inputRefState.current,
            streaming: false,
            summarizing: false,
            tokenCount: tokenCountRef.current,
            maxTokens: maxTokensRef.current,
            error: err,
          });
          setMessages(updated);
        },
        controller.signal,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Summarize failed";
      errorRef.current = message;
      summarizingRef.current = false;
      setError(message);
      setSummarizing(false);
      const updated = messagesRef.current.filter((m) => !m.streaming);
      messagesRef.current = updated;
      setMessages(updated);
      persistDraft({
        sessionId,
        currentSession: currentSessionRef.current,
        messages: updated,
        input: inputRefState.current,
        streaming: false,
        summarizing: false,
        tokenCount: tokenCountRef.current,
        maxTokens: maxTokensRef.current,
        error: message,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const sessionTitle = currentSession?.title ?? "AI Chat";

  return (
    <div className="flex h-[calc(100dvh-9rem)] md:h-[calc(100vh-7rem)] flex-col">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold truncate">{sessionTitle}</h1>
          <p className="text-sm text-muted-foreground">
            Ask questions about your job applications
          </p>
        </div>
        <button
          onClick={handleNewChat}
          disabled={isEmptySession}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-card p-4">
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
                  className="rounded-lg border border-border bg-secondary px-4 py-2 text-left text-sm hover:bg-accent transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {summarizing && messages.every((m) => !m.streaming) && (
              <div className="flex justify-center py-4">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-4 py-2 text-sm text-muted-foreground">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Summarizing conversation…
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground text-sm"
                      : "bg-secondary text-foreground"
                  )}
                >
                  {msg.role === "assistant" ? (
                    msg.content ? (
                      <>
                        <Markdown content={msg.content} />
                        {msg.streaming && (
                          <span className="inline-block h-4 w-0.5 animate-pulse bg-current ml-0.5" />
                        )}
                      </>
                    ) : (
                      <span className="flex gap-1 px-1 py-1">
                        <span className="animate-bounce text-lg leading-none">·</span>
                        <span className="animate-bounce text-lg leading-none [animation-delay:0.1s]">·</span>
                        <span className="animate-bounce text-lg leading-none [animation-delay:0.2s]">·</span>
                      </span>
                    )
                  ) : (
                    <span className="text-sm">{msg.content}</span>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Error */}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {/* Loading phrase */}
      {streaming && loadingPhrase && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="italic">{loadingPhrase}</span>
        </div>
      )}

      {/* Input */}
      <div className="mt-2 flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            const next = e.target.value;
            inputRefState.current = next;
            setInput(next);
            if (sessionId) {
              persistDraft({
                sessionId,
                currentSession: currentSessionRef.current,
                messages: messagesRef.current,
                input: next,
                streaming: streamingRef.current,
                summarizing: summarizingRef.current,
                tokenCount: tokenCountRef.current,
                maxTokens: maxTokensRef.current,
                error: errorRef.current,
              });
            }
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your applications… (Shift+Enter for newline)"
          disabled={streaming || summarizing || !sessionId}
          rows={1}
          style={{ maxHeight: "180px" }}
          className="flex-1 resize-none overflow-y-auto rounded-xl border border-border bg-input px-4 py-3 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 transition-[height]"
        />
        {streaming ? (
          <button
            onClick={handleStop}
            title="Stop generation"
            className="shrink-0 rounded-xl bg-secondary px-4 py-3 text-sm font-medium text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
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
            className="shrink-0 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
