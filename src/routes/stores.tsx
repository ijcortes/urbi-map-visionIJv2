import { seo } from "@/lib/seo";
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/stores')({
  head: () => seo({ title: "Tiendas y negocios · Medellín Social", description: "Negocios locales recomendados por barrio en Medellín.", path: "/stores" }),
  component: StoresRedirect,
})

function StoresRedirect() {
  useEffect(() => { window.location.replace('/local-business/el-poblado') }, [])
  return null
}
