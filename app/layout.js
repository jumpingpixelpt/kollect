import "./globals.css";
// camada neon da rodada 2 (set/2026) — por cima de globals.css, por isso importada depois
import "./neon.css";
import { Inter, Playfair_Display } from "next/font/google";
import { headers } from "next/headers";
import { THEME_BOOT } from "@/lib/theme";

// Fontes servidas pelo próprio domínio (next/font descarrega-as no build): sem <link> para o
// Google Fonts em runtime, sem pedido a terceiros a cada página e sem o achado de SRI do
// pentest (set/2026). Os nomes chegam ao CSS pelas variáveis --font-inter / --font-playfair.
const inter = Inter({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], display: "swap", variable: "--font-inter" });
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500", "700"], style: ["normal", "italic"], display: "swap", variable: "--font-playfair" });

export const metadata = {
  title: "KOLLECT by Snack · Creator Intelligence",
  description: "Creator Intelligence Platform - casting de creators de beauty no TikTok e Instagram.",
};

export default async function RootLayout({ children }) {
  // nonce gerado pelo middleware (lib/csp.js); ler headers() torna o layout dinâmico, de propósito
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // suppressHydrationWarning: o script inline põe data-theme no <html> antes da hidratação
    // e o React, sem isto, avisava do atributo "a mais" vindo do servidor.
    <html lang="pt-BR" suppressHydrationWarning className={`${inter.variable} ${playfair.variable}`}>
      <head>
        {/* aplica o tema guardado antes da primeira pintura — ver lib/theme.js */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
