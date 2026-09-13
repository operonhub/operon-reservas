import type { NextConfig } from "next";

// Lo que se sirve a terceros y alguna web de cabaña podría querer embeber:
// la web pública de reservas, la vuelta del pago, el feed iCal y la API.
const EMBEDDABLE = "reservar|pago|ical|api";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // El panel no se deja enmarcar en un sitio ajeno: sin esto, un iframe
        // invisible podía hacer que el propietario cancelara una reserva o
        // borrara una unidad con un click engañado (auditoría B-05).
        source: `/((?!${EMBEDDABLE}).*)`,
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
