import { useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { auth } from "@/lib/auth";

// "Reclama tu inmueble" (claim your home). El dueño/agente de un listing
// scrapeado lo reclama → nace 'pendiente', el admin verifica. Ver listing_reclamo
// (migr 0102) + POST /listings/{id}/reclamar.

const LABEL = "mb-1 block text-xs font-semibold uppercase tracking-wider text-[#5B5F5C]";
const INPUT =
  "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[#0F8A4F] " +
  "border-[#E5E0D5] bg-white text-[#111418]";

export function ReclamarListingModal({
  listingId,
  onClose,
}: {
  listingId: number;
  onClose: () => void;
}) {
  const u = auth.get();
  const [nombre, setNombre] = useState(u?.name ?? "");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState(u?.email ?? "");
  const [matricula, setMatricula] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [confirma, setConfirma] = useState(false);
  const [estado, setEstado] = useState<"form" | "enviando" | "ok">("form");
  const [err, setErr] = useState<string | null>(null);

  const enviar = async () => {
    if (!nombre.trim() || !telefono.trim()) { setErr("Nombre y teléfono son obligatorios"); return; }
    if (!confirma) { setErr("Confirma que eres el propietario o tienes autorización"); return; }
    setEstado("enviando"); setErr(null);
    try {
      await apiFetch(API_ENDPOINTS.listingReclamar(listingId), {
        method: "POST",
        body: JSON.stringify({
          nombre: nombre.trim(),
          telefono: telefono.trim(),
          email: email.trim() || null,
          matricula_declarada: matricula.trim() || null,
          mensaje: mensaje.trim() || null,
        }),
      });
      setEstado("ok");
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : "No se pudo enviar. Intenta de nuevo.");
      setEstado("form");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {estado === "ok" ? (
          <div className="text-center">
            <div className="mb-3 text-4xl">✅</div>
            <h3 className="mb-2 text-lg font-bold text-[#111418]">Reclamo enviado</h3>
            <p className="mb-5 text-sm leading-relaxed text-[#5B5F5C]">
              Un agente de tu zona te contactará para verificar que el inmueble es tuyo y
              ayudarte a gestionarlo.
            </p>
            <button
              onClick={onClose}
              className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
              style={{ background: "#0F8A4F" }}
            >
              Entendido
            </button>
          </div>
        ) : (
          <>
            <h3 className="mb-1 text-lg font-bold text-[#111418]">¿Este inmueble es tuyo?</h3>
            <p className="mb-4 text-sm leading-relaxed text-[#5B5F5C]">
              Reclámalo y un agente de tu zona te contactará para verificarlo y ayudarte a
              corregir los datos, actualizar el precio y gestionar la venta o arriendo.
            </p>

            <div className="grid gap-3">
              <div>
                <label className={LABEL}>Nombre completo *</label>
                <input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre" />
              </div>
              <div>
                <label className={LABEL}>Teléfono / WhatsApp *</label>
                <input className={INPUT} inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+57 300 000 0000" />
              </div>
              <div>
                <label className={LABEL}>Email</label>
                <input className={INPUT} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" />
              </div>
              <div>
                <label className={LABEL}>Matrícula inmobiliaria (opcional)</label>
                <input className={INPUT} value={matricula} onChange={(e) => setMatricula(e.target.value)} placeholder="Ej: 001-123456 · agiliza la verificación" />
              </div>
              <div>
                <label className={LABEL}>Mensaje (opcional)</label>
                <textarea className={INPUT} rows={2} value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Algo que debamos saber" />
              </div>

              <label className="flex cursor-pointer items-start gap-2 text-sm text-[#111418]">
                <input type="checkbox" checked={confirma} onChange={(e) => setConfirma(e.target.checked)} className="mt-0.5" style={{ accentColor: "#0F8A4F" }} />
                <span>Confirmo que soy el propietario o tengo autorización para gestionar este inmueble.</span>
              </label>

              {err && <p className="text-xs" style={{ color: "#C2410C" }}>{err}</p>}

              <div className="mt-1 flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-[#5B5F5C]"
                  style={{ border: "0.5px solid #E5E0D5" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={enviar}
                  disabled={estado === "enviando"}
                  className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: "#0F8A4F" }}
                >
                  {estado === "enviando" ? "Enviando…" : "Reclamar inmueble"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
