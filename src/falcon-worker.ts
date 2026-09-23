import wasmModule from "./falcon1024.wasm";

type WasmNamespace = {
  Module: abstract new (...args: never[]) => object;
  instantiate(source: unknown, imports?: unknown): Promise<{ instance: object; module?: object } | object>;
};

const webAssembly = (globalThis as unknown as { WebAssembly: WasmNamespace }).WebAssembly;
const original = webAssembly.instantiate.bind(webAssembly);

// Workers reject WebAssembly.instantiate(bytes). The Falcon package embeds
// its wasm and compiles it at runtime, so swap in the precompiled module.
webAssembly.instantiate = async (source, imports) => {
  if (source instanceof webAssembly.Module) {
    return original(source, imports);
  }
  const instance = await original(wasmModule, imports);
  return { instance, module: wasmModule };
};
