import { seo } from "@/lib/seo";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/calculadora")({
  head: () => seo({ title: "Calculadora de rentabilidad · Medellín Social", description: "Calcula yield, cap rate y flujo de caja de un inmueble en Medellín.", path: "/calculadora" }),
  beforeLoad: ({ location }) => {
    throw redirect({
      to: "/simulador",
      search: location.search as Record<string, unknown>,
      replace: true,
    });
  },
});
