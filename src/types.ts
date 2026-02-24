import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type tool<Args extends Record<string, any> = Record<string, any>> = {
  name: string;
  description: string;
  schema: Args;
  handler: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ) => {
    content: Array<{
      type: "text";
      text: string;
    }>;
  };
};
