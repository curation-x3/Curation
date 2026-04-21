import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { mdComponents } from "../lib/markdown";
import type { ChatMessage } from "../lib/chat";

interface ChatMessagesProps {
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
}

export function ChatMessages({
  messages,
  streamingContent,
  isStreaming,
}: ChatMessagesProps) {
  if (messages.length === 0 && !isStreaming) return null;

  return (
    <div className="chat-messages">
      {messages.map((msg) => (
        <div key={msg.id} className={`chat-bubble chat-bubble-${msg.role}`}>
          {msg.role === "assistant" ? (
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={mdComponents}
              >
                {msg.content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="chat-bubble-text">{msg.content}</div>
          )}
        </div>
      ))}

      {isStreaming && streamingContent && (
        <div className="chat-bubble chat-bubble-assistant">
          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={mdComponents}
            >
              {streamingContent}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {isStreaming && !streamingContent && (
        <div className="chat-bubble chat-bubble-assistant">
          <div className="chat-typing-indicator">
            <span /><span /><span />
          </div>
        </div>
      )}
    </div>
  );
}
