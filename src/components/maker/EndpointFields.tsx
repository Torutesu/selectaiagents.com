"use client";
import { isLoopbackEndpoint } from "@/lib/endpoint-timeout";
import {
  CHAT_INPUT,
  CHAT_OUTPUT,
  type EndpointConfig,
} from "@/lib/endpoint-config";
export const newEndpoint: EndpointConfig = {
  id: "run",
  description: "Answer a task using chat messages",
  url: "",
  contract: "chat.v1",
  adapter: "json",
  inputSchema: CHAT_INPUT,
  outputSchema: CHAT_OUTPUT,
  priceMicros: 10000,
  timeoutMs: 15000,
  sideEffects: true,
};
export function EndpointFields({
  text,
  onChange,
  lockId = false,
  allowLocalUpstream = false,
}: {
  text: string;
  onChange: (text: string) => void;
  lockId?: boolean;
  allowLocalUpstream?: boolean;
}) {
  let config: EndpointConfig | undefined;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      config = parsed;
  } catch {}
  const update = (patch: Partial<EndpointConfig>) =>
    onChange(JSON.stringify({ ...config, ...patch }, null, 2));
  return (
    <div className="maker-fields">
      <div className="maker-notice">
        <strong>Your endpoint is where we send tasks.</strong>
        <p>
          {allowLocalUpstream
            ? "Use an HTTPS address, or a loopback HTTP address for local development. "
            : "Use your agent’s HTTPS address. "}
          Your API key is attached separately by an operator—never paste a
          secret into this form.
        </p>
      </div>
      {config && (
        <>
          <label className="maker-field">
            <span>Endpoint URL</span>
            <input
              type="url"
              required
              value={config.url ?? ""}
              placeholder="https://your-agent.com/run"
              onChange={(e) => update({ url: e.target.value })}
            />
            <small>
              A direct POST endpoint, without keys or tokens in the URL.
            </small>
          </label>
          <div className="maker-field-pair">
            <label className="maker-field">
              <span>Connection format</span>
              <select
                value={
                  config.contract !== "chat.v1" ? "custom" : config.adapter
                }
                onChange={(e) => {
                  if (e.target.value !== "custom")
                    update({
                      adapter: e.target.value as "json" | "openai",
                      contract: "chat.v1",
                      inputSchema: CHAT_INPUT,
                      outputSchema: CHAT_OUTPUT,
                    });
                  else update({ adapter: "json", contract: "custom.v1" });
                }}
              >
                <option value="json">Chat messages → text response</option>
                <option value="openai">OpenAI-compatible chat endpoint</option>
                <option value="custom">Custom JSON contract (advanced)</option>
              </select>
              <small>
                {config.adapter === "openai"
                  ? "For a provider that accepts chat completion requests."
                  : "The standard chat format receives messages and returns a content string."}
              </small>
            </label>
            <label className="maker-field">
              <span>Endpoint name</span>
              <input
                value={config.id ?? ""}
                disabled={lockId}
                pattern="[a-z0-9-]{1,40}"
                required
                maxLength={40}
                onChange={(e) => update({ id: e.target.value })}
              />
              <small>
                Usually “run”. Used to identify this action in the API.
              </small>
            </label>
          </div>
          {config.adapter === "openai" && (
            <label className="maker-field">
              <span>Provider model name</span>
              <input
                required
                maxLength={150}
                value={config.upstreamModel ?? ""}
                placeholder="Your provider’s model ID"
                onChange={(e) => update({ upstreamModel: e.target.value })}
              />
              <small>The exact model name accepted by your provider.</small>
            </label>
          )}
          <label className="maker-field">
            <span>Action description</span>
            <input
              required
              minLength={5}
              maxLength={200}
              value={config.description ?? ""}
              onChange={(e) => update({ description: e.target.value })}
            />
            <small>What happens when someone calls this endpoint?</small>
          </label>
          <div className="maker-field-pair">
            <label className="maker-field">
              <span>Price per successful call (USD)</span>
              <input
                type="number"
                required
                min={0}
                max={10}
                step="0.000001"
                value={
                  Number.isFinite(config.priceMicros)
                    ? config.priceMicros / 1e6
                    : ""
                }
                onChange={(e) =>
                  update({
                    priceMicros:
                      e.target.value === ""
                        ? NaN
                        : Math.round(Number(e.target.value) * 1e6),
                  })
                }
              />
              <small>
                Set 0 for free. Failed calls are not charged. Changing price
                requires approval.
              </small>
            </label>
            <label className="maker-field">
              <span>Response timeout (seconds)</span>
              <input
                type="number"
                required
                min={0.1}
                max={
                  allowLocalUpstream && isLoopbackEndpoint(config.url)
                    ? 120
                    : 20
                }
                step={0.1}
                value={
                  Number.isFinite(config.timeoutMs)
                    ? config.timeoutMs / 1000
                    : ""
                }
                onChange={(e) =>
                  update({
                    timeoutMs:
                      e.target.value === ""
                        ? NaN
                        : Math.round(Number(e.target.value) * 1000),
                  })
                }
              />
              <small>
                {allowLocalUpstream && isLoopbackEndpoint(config.url)
                  ? "Local development: up to 120 seconds. Set the agent’s own deadline slightly shorter."
                  : "How long the router should wait, up to 20 seconds."}
              </small>
            </label>
          </div>
          <label className="maker-field">
            <span>Can this action change anything outside the chat?</span>
            <select
              value={config.sideEffects === false ? "read" : "write"}
              onChange={(e) =>
                update({ sideEffects: e.target.value === "write" })
              }
            >
              <option value="write">Yes, or I’m not sure</option>
              <option value="read">
                No, it only reads information or generates text
              </option>
            </select>
            <small>
              Sending emails, editing files, or making purchases count as
              changes. The router avoids retrying an uncertain action on another
              agent.
            </small>
          </label>
        </>
      )}
      <details
        className="maker-advanced"
        open={!config || config.contract !== "chat.v1"}
      >
        <summary>Advanced: request and response contract</summary>
        <p className="text-sm text-muted">
          Standard chat receives{" "}
          <code>{'{"messages":[{"role":"user","content":"Hello"}]}'}</code> and
          returns <code>{'{"content":"Hello back"}'}</code>. Custom contracts
          need matching JSON schemas and operator review.
        </p>
        <label className="maker-field">
          <span>Endpoint configuration (JSON)</span>
          <textarea
            rows={18}
            value={text}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono text-xs"
          />
        </label>
        {!config && (
          <p role="alert" className="text-down text-sm">
            Enter a valid JSON object to use the guided fields.
          </p>
        )}
        {lockId && (
          <p className="text-xs text-muted">
            Keep the endpoint name unchanged when editing. Use “Add endpoint”
            for a new action.
          </p>
        )}
      </details>
    </div>
  );
}
