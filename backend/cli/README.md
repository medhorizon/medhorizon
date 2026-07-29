# @synsci/openscience

MedHorizon is a model-agnostic, open-source AI research agent for scientific and ML engineering work. It runs a workspace in your browser where the agent plans tasks, writes and runs code, drives experiments, queries scientific databases, and writes up results. Bring your own API key or sign in with Atlas, use any frontier or open-weight model, and work with the bundled science skills.

Part of the [MedHorizon](https://github.com/medhorizon/medhorizon) repository.

## Install

```bash
npm install -g @synsci/openscience
```

The command is `medhorizon` (`openscience` remains available as a compatibility alias).

On Linux, the bundled runtime requires kernel 5.1 or newer. Glibc binaries require glibc 2.17 or newer; separate musl packages are selected automatically. CentOS 7's stock 3.10 kernel is unsupported. On Linux ARM64, Bun-compiled executables currently require a 4 KB kernel page size; 16 KB and 64 KB page kernels fail early with a clear diagnostic while [upstream support](https://github.com/oven-sh/bun/issues/17627) remains open.

## Quick start

```bash
medhorizon                     # open the workspace in your browser
medhorizon ~/code/project      # open it in a specific directory
medhorizon login               # sign in to Atlas (optional; BYOK works without an account)
medhorizon run "..."           # run a one-shot task
```

Configuration lives in `~/.config/openscience/openscience.json`. Provider keys can be set in the workspace (bring your own key) or synced from Atlas.

## Docs

See the [repository README](https://github.com/medhorizon/medhorizon#readme) for the full layout, provider setup, agent and skill architecture, and contribution guide.

## License

Apache License 2.0. See [LICENSE](https://github.com/medhorizon/medhorizon/blob/main/LICENSE). Not affiliated with Anthropic.
