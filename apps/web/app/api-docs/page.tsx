import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Conductor API Reference",
  description: "Interactive Scalar reference for the Conductor API.",
};

export const dynamic = "force-static";

/**
 * /api-docs — Scalar reference rendered against /api/openapi.json.
 *
 * Loaded from Scalar's public CDN bundle so we don't add
 * `@scalar/api-reference-react` to the package graph; the bundle is small
 * and the docs page works even if the React adapter and our zod 4 toolchain
 * fall out of sync. The bundle reads its config from the JSON inside the
 * `#api-reference` script tag below.
 */
export default function ApiDocsPage(): React.ReactElement {
  const config = {
    spec: { url: "/api/openapi.json" },
    theme: "default",
    metaData: { title: "Conductor API" },
  };
  return (
    <main className="min-h-screen w-full">
      <script
        id="api-reference"
        type="application/json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: required to seed Scalar config
        dangerouslySetInnerHTML={{ __html: JSON.stringify(config) }}
      />
      <Script
        src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"
        strategy="afterInteractive"
      />
    </main>
  );
}
