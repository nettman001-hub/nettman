export type CustomAiEndpointStyle = "responses" | "chat-completions";

export type CustomAiEndpointPlan = {
  requestEndpoint: string;
  modelsEndpoint: string;
  style: CustomAiEndpointStyle;
};

function pathnameParts(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function endpointWithPath(source: URL, parts: string[]): string {
  const next = new URL(source.toString());
  next.pathname = `/${parts.join("/")}`;
  next.search = "";
  next.hash = "";
  return next.toString();
}

export function planCustomAiEndpoint(endpoint: string): CustomAiEndpointPlan {
  const url = new URL(endpoint);
  const parts = pathnameParts(url.pathname);
  const lower = parts.map((part) => part.toLowerCase());
  const last = lower.at(-1);
  const previous = lower.at(-2);

  if (previous === "chat" && last === "completions") {
    return {
      requestEndpoint: endpointWithPath(url, parts),
      modelsEndpoint: endpointWithPath(url, [...parts.slice(0, -2), "models"]),
      style: "chat-completions",
    };
  }

  if (last === "responses") {
    return {
      requestEndpoint: endpointWithPath(url, parts),
      modelsEndpoint: endpointWithPath(url, [...parts.slice(0, -1), "models"]),
      style: "responses",
    };
  }

  if (!parts.length) {
    return {
      requestEndpoint: endpointWithPath(url, ["v1", "chat", "completions"]),
      modelsEndpoint: endpointWithPath(url, ["v1", "models"]),
      style: "chat-completions",
    };
  }

  if (last === "v1") {
    return {
      requestEndpoint: endpointWithPath(url, [...parts, "chat", "completions"]),
      modelsEndpoint: endpointWithPath(url, [...parts, "models"]),
      style: "chat-completions",
    };
  }

  const v1Index = lower.lastIndexOf("v1");
  const modelsParts =
    v1Index >= 0
      ? [...parts.slice(0, v1Index + 1), "models"]
      : [...parts.slice(0, -1), "models"];
  return {
    requestEndpoint: endpointWithPath(url, parts),
    modelsEndpoint: endpointWithPath(url, modelsParts),
    style: "responses",
  };
}
