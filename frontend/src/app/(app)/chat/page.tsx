/**
 * AI Chat page with RAG-powered responses.
 * Messages stream in via SSE. Supports suggested questions when history is empty.
 * LLM responses are rendered as markdown.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { getChatHistory, clearChatHistory, streamChat } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Message {
  id?: number;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
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
  // Viking-style
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
  // Smart / punny
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

// ── Markdown renderer (no extra packages) ────────────────────────────────────

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

    // Fenced code block
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
    }

    // Headings
    if (line.startsWith("### ")) {
      flushList();
      nodes.push(<p key={i} className="mt-3 mb-0.5 font-semibold">{inlineMarkdown(line.slice(4))}</p>);
    } else if (line.startsWith("## ")) {
      flushList();
      nodes.push(<p key={i} className="mt-3 mb-1 text-base font-bold">{inlineMarkdown(line.slice(3))}</p>);
    } else if (line.startsWith("# ")) {
      flushList();
      nodes.push(<p key={i} className="mt-3 mb-1 text-lg font-bold">{inlineMarkdown(line.slice(2))}</p>);
    }
    // Bullet list
    else if (/^[-*] /.test(line)) {
      if (listType !== "ul") { flushList(); listType = "ul"; }
      listItems.push(<li key={i}>{inlineMarkdown(line.slice(2))}</li>);
    }
    // Numbered list
    else if (/^\d+\. /.test(line)) {
      if (listType !== "ol") { flushList(); listType = "ol"; }
      listItems.push(<li key={i}>{inlineMarkdown(line.replace(/^\d+\. /, ""))}</li>);
    }
    // Horizontal rule
    else if (/^---+$/.test(line.trim())) {
      flushList();
      nodes.push(<hr key={i} className="my-2 border-current opacity-20" />);
    }
    // Empty line
    else if (line.trim() === "") {
      flushList();
      nodes.push(<div key={i} className="h-2" />);
    }
    // Normal text
    else {
      flushList();
      nodes.push(<p key={i} className="leading-relaxed">{inlineMarkdown(line)}</p>);
    }

    i++;
  }

  flushList();
  return <div className="space-y-0.5 text-sm">{nodes}</div>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [loadingPhrase, setLoadingPhrase] = useState("");
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const history = await getChatHistory();
        setMessages(
          history.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        );
      } catch {
        // History load failure is non-critical
      } finally {
        setLoading(false);
      }
    };
    loadHistory();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cycle through fun loading phrases while the LLM is streaming
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
    if (!msg || streaming) return;

    setInput("");
    setError("");

    const userMessage: Message = { role: "user", content: msg };
    const assistantMessage: Message = { role: "assistant", content: "", streaming: true };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        msg,
        (token) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.streaming) {
              updated[updated.length - 1] = { ...last, content: last.content + token };
            }
            return updated;
          });
        },
        () => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.streaming) {
              updated[updated.length - 1] = { ...last, streaming: false };
            }
            return updated;
          });
          setStreaming(false);
        },
        (err) => {
          setError(err);
          setStreaming(false);
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.streaming) {
              updated[updated.length - 1] = {
                ...last,
                content: "Sorry, something went wrong. Please try again.",
                streaming: false,
              };
            }
            return updated;
          });
        },
        controller.signal,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stream failed");
      setStreaming(false);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.streaming) {
        updated[updated.length - 1] = { ...last, streaming: false };
      }
      return updated;
    });
  };

  const handleClear = async () => {
    try {
      await clearChatHistory();
      setMessages([]);
    } catch {
      setError("Failed to clear history");
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

  return (
    <div className="flex h-[calc(100dvh-9rem)] md:h-[calc(100vh-7rem)] flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Chat</h1>
          <p className="text-sm text-muted-foreground">
            Ask questions about your job applications
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Clear History
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-card p-4">
        {messages.length === 0 ? (
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
                      // Waiting for first token
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
      <div className="mt-2 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your applications… (Enter to send, Shift+Enter for newline)"
          disabled={streaming}
          rows={2}
          className="flex-1 resize-none rounded-lg border border-border bg-input px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        {streaming ? (
          <button
            onClick={handleStop}
            title="Stop generation"
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop
          </button>
        ) : (
          <button
            onClick={() => handleSend()}
            disabled={!input.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
