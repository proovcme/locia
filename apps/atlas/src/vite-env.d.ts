declare module "*?url" {
  const url: string;
  export default url;
}

interface ImportMetaEnv {
  readonly VITE_PUBLIC_ATLAS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
