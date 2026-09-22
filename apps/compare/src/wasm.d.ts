declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

// jSquash declares Rust exports here; Wrangler imports a compiled module.
declare module "@jsquash/png/codec/pkg/squoosh_png_bg.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
