"use client";

import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import { parseChatText } from "@/lib/chatText";
import type { ChatMsg } from "@/lib/domain/chat/chatSessionState";

export default function MessageBubble({
  msg,
  isLast,
  actions,
}: {
  msg: ChatMsg;
  /** The newest message gets the copy button. */
  isLast: boolean;
  /** Slot for future action cards under an assistant reply. Renders nothing today. */
  actions?: ReactNode;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-xl bg-[#ecedef] px-3.5 py-2 text-[13px] text-gray-800">
          {msg.text}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-gray-700">
      {parseChatText(msg.text).map((b, k) =>
        b.kind === "p" ? (
          <p key={k} className="break-words">{b.text}</p>
        ) : (
          (b.kind === "ol" ? (
            <ol key={k} className="list-decimal space-y-1.5 pl-5 marker:text-gray-400">
              {b.items.map((it, j) => <li key={j} className="break-words pl-1">{it}</li>)}
            </ol>
          ) : (
            <ul key={k} className="list-disc space-y-1.5 pl-5 marker:text-gray-400">
              {b.items.map((it, j) => <li key={j} className="break-words pl-1">{it}</li>)}
            </ul>
          ))
        ),
      )}
      {msg.lookedAt && msg.lookedAt.length > 0 && (
        <p className="text-xs text-ui-subtle">Looked at: {msg.lookedAt.join(", ")}</p>
      )}
      {msg.list && (
        <ol className="list-decimal space-y-1.5 pl-5">
          {msg.list.map((item, j) => (
            <li key={j}>{item}</li>
          ))}
        </ol>
      )}
      {msg.goodToKnow && (
        <>
          <p className="font-semibold text-gray-900">Good to know:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            {msg.goodToKnow.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        </>
      )}
      {msg.footer && <p>{msg.footer}</p>}
      {actions}
      {isLast && (
        <div className="flex items-center gap-3 pt-1 text-ui-subtle">
          <Copy
            size={13}
            className="cursor-pointer hover:text-gray-600"
            onClick={() => navigator.clipboard?.writeText(msg.text)}
          />
        </div>
      )}
    </div>
  );
}
