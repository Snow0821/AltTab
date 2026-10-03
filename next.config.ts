import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // unpdf는 서버에서 쓰지 않고 브라우저에서 PDF 글자를 뽑는다(서버 요청 크기 4.5MB 제한 회피).
  serverExternalPackages: ["postgres"],
  async redirects() {
    return [{ source: "/study", destination: "/exam-workspace/index.html", permanent: false }];
  },
};

export default nextConfig;
