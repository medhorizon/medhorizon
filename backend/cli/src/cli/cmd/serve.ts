import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { startResearchGraphSidecar, stopResearchGraphSidecar } from "../../sidecar/research-graph"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless MedHorizon server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    await startResearchGraphSidecar()
    console.log(`MedHorizon server listening on http://localhost:${server.port}`)
    await new Promise<void>((resolve) => {
      const stop = () => resolve()
      process.once("SIGINT", stop)
      process.once("SIGTERM", stop)
    })
    await stopResearchGraphSidecar()
    await server.stop()
  },
})
