import Toolbox from "./toolbox";
import { resolveToolId } from "./tool-id";
import { CoreLinks } from "./site-content";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const tool = resolveToolId(params.tool);
  return <main><Toolbox key={tool ?? "home"} initialTool={tool} /><CoreLinks /></main>;
}
