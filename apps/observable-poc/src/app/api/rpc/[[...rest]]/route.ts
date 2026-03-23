import { RPCHandler } from "@orpc/server/fetch";
import { appRouter } from "@/lib/orpc/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rpcHandler = new RPCHandler(appRouter);

async function handleRequest(request: Request): Promise<Response> {
  const result = await rpcHandler.handle(request, {
    prefix: "/api/rpc",
  });

  if (!result.matched) {
    return new Response("Not Found", { status: 404 });
  }

  return result.response;
}

export const GET = handleRequest;
export const POST = handleRequest;
