interface ImportMetaEnv {
  readonly VITE_KI_UI?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.css' {
  const content: string
  export default content
}
