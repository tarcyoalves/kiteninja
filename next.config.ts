import type { NextConfig } from "next";

const buildCommit =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  "local";

const nextConfig: NextConfig = {
  // Congela no bundle o commit que o usuário abriu. A rota /api/version lê o
  // commit do deploy atual; comparar os dois detecta atualização mesmo quando
  // a primeira checagem só acontece depois de um novo deploy.
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: buildCommit,
  },
};

export default nextConfig;
