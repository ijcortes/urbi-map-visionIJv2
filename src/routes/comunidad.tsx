import { seo } from "@/lib/seo";
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/comunidad')({
  head: () => seo({ title: "Comunidad · Medellín Social", description: "Eventos, negocios locales y noticias de tu barrio en Medellín.", path: "/comunidad" }),
  component: ComunidadRedirect,
})

function ComunidadRedirect() {
  useEffect(() => { window.location.replace('/eventos/el-poblado') }, [])
  return null
}
