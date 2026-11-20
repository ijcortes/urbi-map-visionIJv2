# docs/ — Índice

**Empieza aquí:** [ARCHITECTURE.md](ARCHITECTURE.md) — el mapa único de todo el sistema
(qué archivo hace qué, cómo se conecta todo, modelo de negocio, bugs conocidos). Los demás
docs son fuentes de detalle o entregables.

## 📐 Arquitectura y decisiones
- [ARCHITECTURE.md](ARCHITECTURE.md) — **documento maestro** (código + datos + negocio)
- [adr/](adr/) — Architecture Decision Records (el *por qué*):
  [0001 ciudad_id](adr/adr-0001-ciudad-id-multi-ciudad.md) ·
  [0002 reproducible DEV→PROD](adr/adr-0002-reproducible-dev-prod.md) ·
  [0003 cache swap-table](adr/adr-0003-cache-swap-table.md) ·
  [0004 GHL bloqueado/pull](adr/adr-0004-ghl-bloqueado-pull.md) ·
  [0005 dos stacks publicación](adr/adr-0005-dos-stacks-publicacion.md) ·
  [0006 analytics dbt vs scripts](adr/adr-0006-analytics-dbt-vs-scripts.md) ·
  [0007 pagos vía GHL](adr/adr-0007-pagos-via-ghl.md)
- [INFRAESTRUCTURA.md](INFRAESTRUCTURA.md) — decisión PaaS Railway (framework; sección GHL stale)

## 🗄️ Datos
- [SCOPE_DATOS_2026-10-22.md](SCOPE_DATOS_2026-10-22.md) — **auditoría de scope de datos en prod** (L1/L2/L3), source-of-truth actual
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) + [database/](database/) — schema (Mermaid+DBML), autogenerado por `scripts/generate_db_schema_docs.py` ⚠️ regenerar (drift ~15+ migr)
- [INVENTARIO_DATOS.md](INVENTARIO_DATOS.md) — inventario tabla por tabla (ago; conteos algo stale)
- [estratos.md](estratos.md) · [indice_verde.md](indice_verde.md) — referencia de metodología (estable)
- [RESUMEN_LEGAL_DATOS.md](RESUMEN_LEGAL_DATOS.md) — cumplimiento Ley 1581 (bloqueantes de producción)

## 💼 Negocio y funnel
- [MISION_VISION.md](MISION_VISION.md) — misión/visión + modelo (canónico)
- [FUNNEL_B2B.md](FUNNEL_B2B.md) — **embudo B2B** (vivo, se construye por capas)
- [ESTADO_MEDELLIN_SOCIAL_2026-10-23.md](ESTADO_MEDELLIN_SOCIAL_2026-10-23.md) — fotografía ejecutiva de estado
- [Medellín Social — To-do.md](Medellín%20Social%20—%20To-do.md) · [Pendientes y roles.md](Medellín%20Social%20—%20Pendientes%20y%20roles.md) — planeación + matriz "qué ve cada quien"
- [TUTORIAL_NAVEGACION.md](TUTORIAL_NAVEGACION.md) — guía de navegación del usuario

## 🔗 GHL (integración CRM — Talal)
- [GHL_CONTRATO_PROPUESTO.md](GHL_CONTRATO_PROPUESTO.md) — **contrato consolidado (canónico)**
- [GHL_ENDPOINTS_FUNNEL_STATUS.md](GHL_ENDPOINTS_FUNNEL_STATUS.md) — estado de wiring/creds
- [GHL_TALAL_TEST_HANDOFF.md](GHL_TALAL_TEST_HANDOFF.md) — handoff de test
- [GOOGLE_AUTH_SETUP.md](GOOGLE_AUTH_SETUP.md) — setup OAuth Google/Gmail

## 📎 Entregables (binarios — no editar, son snapshots enviados a stakeholders)
- `Medellin-Social-GHL-Architecture.pdf`, `panel-resultados-realtor.pdf`,
  `Medellin-Social-Programa-Inmobiliario-ES.{md,docx}` *(duplicado: quedarse con uno)*

## 🌎 Partner / expansión (vivos solo si esas agendas siguen — ver ARCHITECTURE §11.3)
- Panamá: `Paquete_Maestro_Red_de_Referidos_Panama_Social_ES.txt`, `Copia de Usefull sites…Panama.docx`
- EASE/EasyStreet: `EASY Street SOPs SOW.txt`, `EASE Product and Pricing Schedule.*`, `MEDELLÍN SOCIAL – CERTIFIED REALTOR PROGRAM.txt`

## 🗑️ Candidatos a limpieza (ver [ARCHITECTURE §11](ARCHITECTURE.md#11-archivos-sin-conexión--candidatos-a-limpieza))
`rail 1.png`, `rail2.png`, `ALL-ISSUES.pdf`, `INVENTARIO_DATOS.pdf`, `PROMPT_AUDITORIA_DATOS_SCOPE.md`,
5 landings HTML, `prompt_alcance_monetario.md`, `GHL_DB_SCHEMA_FIELDS.pdf`.

> Convención de estado y la lista completa de código/docs muertos y dudosos: **[ARCHITECTURE §11](ARCHITECTURE.md#11-archivos-sin-conexión--candidatos-a-limpieza)**.
