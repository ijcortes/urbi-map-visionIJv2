import { seo } from "@/lib/seo";
import { createFileRoute } from "@tanstack/react-router";
import { useLang } from "@/lib/i18n";
import { BarrioProvider } from "@/components/comunidad/BarrioContext";
import { ComunidadNavbar } from "@/components/comunidad/ComunidadNavbar";

export const Route = createFileRoute("/politica-privacidad")({
  head: () => seo({
    title: "Política de Tratamiento de Datos · Medellín Social",
    description: "Política de tratamiento de datos personales (Ley 1581 de 2012, Decretos 1377 de 2013 y 1074 de 2015).",
    path: "/politica-privacidad",
  }),
  component: PoliticaPrivacidadPage,
});

// ponytail: texto legal completo, bilingüe (ES/EN inline — no diccionario, para que
// el calce sea exacto en un documento vinculante). Lo ÚNICO por completar son los
// identificadores de la persona jurídica responsable (razón social, NIT, domicilio)
// — no se pueden inventar. Al modificar el texto, subir api/legal.py
// HABEAS_DATA_VERSION. Recomendado: validación por abogado colombiano habilitado.

const VIGENCIA = { es: "7 de noviembre de 2026", en: "November 7, 2026" };

type Bloque =
  | { tipo: "p"; es: string; en: string }
  | { tipo: "lista"; es: string[]; en: string[] };

type Seccion = { es: string; en: string; bloques: Bloque[] };

const SECCIONES: Seccion[] = [
  {
    es: "1. Identificación del Responsable del Tratamiento",
    en: "1. Identification of the Data Controller",
    bloques: [
      {
        tipo: "p",
        es: "Medellín Social (en adelante, «Medellín Social», «la Plataforma» o «el Responsable») es responsable del tratamiento de los datos personales recolectados a través del sitio web medellinsocial.com, sus subdominios y aplicaciones asociadas. Los datos de identificación del Responsable son:",
        en: "Medellín Social (hereinafter «Medellín Social», «the Platform» or «the Controller») is responsible for processing the personal data collected through the website medellinsocial.com, its subdomains and associated applications. The Controller's identification details are:",
      },
      {
        tipo: "lista",
        es: [
          "Razón social: [RAZÓN SOCIAL DE LA PERSONA JURÍDICA — POR COMPLETAR].",
          "NIT: [NÚMERO DE IDENTIFICACIÓN TRIBUTARIA — POR COMPLETAR].",
          "Domicilio y dirección de notificaciones: [DIRECCIÓN FÍSICA, CIUDAD, COLOMBIA — POR COMPLETAR].",
          "Correo electrónico de atención al titular: privacidad@medellinsocial.com.",
          "Teléfono / WhatsApp de atención: [TELÉFONO — POR COMPLETAR].",
          "Sitio web: https://medellinsocial.com.",
        ],
        en: [
          "Legal name: [LEGAL NAME OF THE ENTITY — TO BE COMPLETED].",
          "Tax ID (NIT): [TAX IDENTIFICATION NUMBER — TO BE COMPLETED].",
          "Registered address and address for notices: [PHYSICAL ADDRESS, CITY, COLOMBIA — TO BE COMPLETED].",
          "Data subject support email: privacidad@medellinsocial.com.",
          "Support phone / WhatsApp: [PHONE — TO BE COMPLETED].",
          "Website: https://medellinsocial.com.",
        ],
      },
      {
        tipo: "p",
        es: "Nota: los campos marcados como «POR COMPLETAR» corresponden a los datos registrales de la persona jurídica responsable y deben diligenciarse antes de la publicación definitiva. El resto de esta política es vinculante y aplicable en su integridad.",
        en: "Note: the fields marked «TO BE COMPLETED» are the corporate registration details of the controlling entity and must be filled in before final publication. The rest of this policy is binding and applies in full.",
      },
    ],
  },
  {
    es: "2. Marco legal",
    en: "2. Legal framework",
    bloques: [
      {
        tipo: "p",
        es: "Esta política se expide en cumplimiento de la normativa colombiana vigente sobre protección de datos personales, en particular:",
        en: "This policy is issued in compliance with Colombian data protection law, in particular:",
      },
      {
        tipo: "lista",
        es: [
          "Constitución Política de Colombia, artículos 15 (hábeas data e intimidad) y 20 (información).",
          "Ley Estatutaria 1581 de 2012, por la cual se dictan disposiciones generales para la protección de datos personales.",
          "Decreto 1377 de 2013, reglamentario de la Ley 1581 de 2012.",
          "Decreto Único Reglamentario 1074 de 2015 (Capítulo 25), que compila la reglamentación en materia de protección de datos.",
          "Ley 1480 de 2011 (Estatuto del Consumidor) y Ley 527 de 1999 (comercio electrónico), en lo aplicable.",
          "Circulares e instrucciones de la Superintendencia de Industria y Comercio (SIC), autoridad de control.",
        ],
        en: [
          "Political Constitution of Colombia, articles 15 (habeas data and privacy) and 20 (information).",
          "Statutory Law 1581 of 2012, establishing general provisions for the protection of personal data.",
          "Decree 1377 of 2013, regulating Law 1581 of 2012.",
          "Single Regulatory Decree 1074 of 2015 (Chapter 25), compiling data protection regulations.",
          "Law 1480 of 2011 (Consumer Statute) and Law 527 of 1999 (electronic commerce), where applicable.",
          "Circulars and instructions of the Superintendence of Industry and Commerce (SIC), the supervisory authority.",
        ],
      },
    ],
  },
  {
    es: "3. Definiciones",
    en: "3. Definitions",
    bloques: [
      {
        tipo: "p",
        es: "Para los efectos de esta política, y conforme al artículo 3 de la Ley 1581 de 2012, se entiende por:",
        en: "For the purposes of this policy, and pursuant to article 3 of Law 1581 of 2012, the following definitions apply:",
      },
      {
        tipo: "lista",
        es: [
          "Titular: persona natural cuyos datos personales son objeto de tratamiento.",
          "Dato personal: cualquier información vinculada o que pueda asociarse a una o varias personas naturales determinadas o determinables.",
          "Dato sensible: aquel que afecta la intimidad del titular o cuyo uso indebido puede generar discriminación (p. ej. salud, orientación sexual, convicciones, datos biométricos). Medellín Social no recolecta datos sensibles de forma deliberada.",
          "Dato público, semiprivado y privado: según su grado de reserva y las fuentes de las que provienen.",
          "Responsable del Tratamiento: Medellín Social, quien decide sobre la base de datos y su tratamiento.",
          "Encargado del Tratamiento: persona natural o jurídica que trata los datos por cuenta del Responsable (p. ej. proveedores de nube, CRM o correo).",
          "Autorización: consentimiento previo, expreso e informado del titular para el tratamiento.",
          "Tratamiento: cualquier operación sobre datos personales (recolección, almacenamiento, uso, circulación, supresión).",
          "Transmisión y Transferencia: comunicación de datos a un Encargado (transmisión) o a otro Responsable (transferencia), dentro o fuera de Colombia.",
        ],
        en: [
          "Data subject (Titular): the natural person whose personal data is processed.",
          "Personal data: any information linked to or that can be associated with one or more identified or identifiable natural persons.",
          "Sensitive data: data affecting the subject's privacy or whose misuse may lead to discrimination (e.g. health, sexual orientation, beliefs, biometric data). Medellín Social does not deliberately collect sensitive data.",
          "Public, semi-private and private data: according to their degree of confidentiality and their source.",
          "Data Controller: Medellín Social, which decides over the database and its processing.",
          "Data Processor: the natural or legal person that processes data on behalf of the Controller (e.g. cloud, CRM or email providers).",
          "Authorization: the subject's prior, express and informed consent to the processing.",
          "Processing: any operation on personal data (collection, storage, use, circulation, deletion).",
          "Transmission and Transfer: communication of data to a Processor (transmission) or to another Controller (transfer), within or outside Colombia.",
        ],
      },
    ],
  },
  {
    es: "4. Datos personales que recolectamos",
    en: "4. Personal data we collect",
    bloques: [
      {
        tipo: "p",
        es: "Según su interacción con la Plataforma, Medellín Social puede recolectar las siguientes categorías de datos:",
        en: "Depending on your interaction with the Platform, Medellín Social may collect the following categories of data:",
      },
      {
        tipo: "lista",
        es: [
          "Identificación y contacto: nombre, apellido, correo electrónico y número de teléfono/WhatsApp.",
          "Credenciales de acceso: contraseña (almacenada siempre cifrada mediante hash; nunca en texto claro ni visible para Medellín Social) y tokens de sesión y de verificación.",
          "Datos de inicio de sesión con Google (si el titular usa «Continuar con Google»): identificador de cuenta de Google, correo y nombre proporcionados por Google.",
          "Perfil e intereses declarados: perfil de búsqueda (comprar, invertir, vender, agente), objetivo de inversión, presupuesto, perfil de riesgo y barrios/zonas marcados como favoritos.",
          "Actividad en la Plataforma: historial de búsquedas, simulaciones, comparaciones, inmuebles vistos, visitas agendadas y solicitudes de contacto (leads) enviadas a agentes.",
          "Datos técnicos y de navegación: dirección IP, tipo de dispositivo y navegador (user-agent), eventos de uso (vistas de página, vistas de inmueble, interacciones) e identificadores almacenados en cookies o almacenamiento local del navegador.",
          "Datos de agentes y agencias (cuando el titular se registra como tal): nombre, correo, teléfono, biografía, foto de perfil, zonas atendidas y estado de verificación.",
          "Datos de propietarios y de los inmuebles que publican: características del inmueble, fotos y datos de contacto suministrados.",
          "Datos de contacto de anunciantes/agentes contenidos en avisos inmobiliarios de fuentes de acceso público que la Plataforma agrega o indexa (ver sección 15).",
        ],
        en: [
          "Identification and contact: first name, last name, email address and phone/WhatsApp number.",
          "Access credentials: password (always stored encrypted via hashing; never in clear text nor visible to Medellín Social) and session and verification tokens.",
          "Google sign-in data (if the subject uses «Continue with Google»): Google account identifier, email and name provided by Google.",
          "Declared profile and interests: search profile (buy, invest, sell, agent), investment goal, budget, risk profile and neighborhoods/zones marked as favorites.",
          "Activity on the Platform: search history, simulations, comparisons, listings viewed, scheduled visits and contact requests (leads) sent to agents.",
          "Technical and browsing data: IP address, device and browser type (user-agent), usage events (page views, listing views, interactions) and identifiers stored in cookies or the browser's local storage.",
          "Agent and agency data (when the subject registers as such): name, email, phone, biography, profile photo, service areas and verification status.",
          "Owner data and data of the listings they publish: property details, photos and contact information provided.",
          "Contact data of advertisers/agents contained in real estate listings from publicly accessible sources that the Platform aggregates or indexes (see section 15).",
        ],
      },
      {
        tipo: "p",
        es: "La Plataforma no está dirigida a menores de 18 años y no recolecta conscientemente sus datos. Si un titular suministra datos sensibles de forma voluntaria, responder preguntas sobre ellos es facultativo y el titular no está obligado a autorizar su tratamiento.",
        en: "The Platform is not directed at persons under 18 and does not knowingly collect their data. If a subject voluntarily provides sensitive data, answering questions about it is optional and the subject is not required to authorize its processing.",
      },
    ],
  },
  {
    es: "5. Finalidades del tratamiento",
    en: "5. Purposes of the processing",
    bloques: [
      {
        tipo: "p",
        es: "Los datos personales se tratan para las siguientes finalidades, determinadas y legítimas:",
        en: "Personal data is processed for the following specific and legitimate purposes:",
      },
      {
        tipo: "lista",
        es: [
          "Crear, gestionar y asegurar la cuenta del titular: registro, autenticación, verificación de correo, recuperación y cambio de contraseña.",
          "Prestar los servicios de la Plataforma (mapa, listados, herramientas de análisis) y personalizar recomendaciones según el perfil e intereses del titular.",
          "Conectar al titular con agentes o agencias patrocinadoras de la zona de su interés y enrutar sus solicitudes de contacto o de visita.",
          "Gestionar la publicación de inmuebles de propietarios y agentes, y sus procesos de verificación.",
          "Agendar, confirmar y administrar visitas a inmuebles.",
          "Enviar comunicaciones transaccionales necesarias para el servicio (verificación, restablecimiento de contraseña, confirmaciones de visita).",
          "Enviar comunicaciones comerciales, boletines, ofertas y eventos de interés, únicamente cuando el titular lo haya autorizado; dicha autorización es revocable en cualquier momento.",
          "Contactar por WhatsApp únicamente cuando el titular autorice expresamente ese canal.",
          "Realizar analítica de uso, medición y mejora de la Plataforma.",
          "Garantizar la seguridad, prevenir el fraude, el abuso y el acceso automatizado no autorizado (control de acceso, límites de tasa, listas de revocación de sesiones).",
          "Gestionar la relación comercial y de soporte a través de herramientas de CRM.",
          "Cumplir obligaciones legales, contables y regulatorias, y atender requerimientos de autoridades competentes.",
        ],
        en: [
          "Create, manage and secure the subject's account: registration, authentication, email verification, password recovery and change.",
          "Provide the Platform's services (map, listings, analytics tools) and personalize recommendations according to the subject's profile and interests.",
          "Connect the subject with agents or agencies sponsoring the area of interest and route their contact or visit requests.",
          "Manage the publication of listings by owners and agents, and their verification processes.",
          "Schedule, confirm and manage property visits.",
          "Send transactional communications required for the service (verification, password reset, visit confirmations).",
          "Send commercial communications, newsletters, offers and events of interest, only when the subject has authorized it; such authorization is revocable at any time.",
          "Contact via WhatsApp only when the subject expressly authorizes that channel.",
          "Perform usage analytics, measurement and improvement of the Platform.",
          "Ensure security and prevent fraud, abuse and unauthorized automated access (access control, rate limits, session revocation lists).",
          "Manage the commercial and support relationship through CRM tools.",
          "Comply with legal, accounting and regulatory obligations, and respond to requests from competent authorities.",
        ],
      },
    ],
  },
  {
    es: "6. Autorización del titular",
    en: "6. Data subject's authorization",
    bloques: [
      {
        tipo: "p",
        es: "El tratamiento de datos personales requiere la autorización previa, expresa e informada del titular, salvo las excepciones del artículo 10 de la Ley 1581 de 2012 (p. ej. datos de naturaleza pública, requerimientos de autoridad o urgencias). La autorización se obtiene al momento del registro mediante la aceptación expresa de esta política y del aviso de privacidad.",
        en: "Processing personal data requires the subject's prior, express and informed authorization, except for the cases in article 10 of Law 1581 of 2012 (e.g. public data, requests from authorities or emergencies). Authorization is obtained at registration through express acceptance of this policy and the privacy notice.",
      },
      {
        tipo: "p",
        es: "Medellín Social conserva prueba de la autorización otorgada, incluyendo la versión del aviso aceptado y la fecha, de modo que el consentimiento sea verificable y auditable. La autorización para fines comerciales (boletín, promociones) y para el canal de WhatsApp es independiente, opcional y revocable sin que ello afecte la prestación del servicio.",
        en: "Medellín Social keeps proof of the authorization granted, including the version of the notice accepted and the date, so that consent is verifiable and auditable. Authorization for commercial purposes (newsletter, promotions) and for the WhatsApp channel is separate, optional and revocable without affecting the provision of the service.",
      },
    ],
  },
  {
    es: "7. Encargados, terceros y transferencias internacionales",
    en: "7. Processors, third parties and international transfers",
    bloques: [
      {
        tipo: "p",
        es: "Para operar la Plataforma, Medellín Social se apoya en proveedores que actúan como Encargados del Tratamiento y que pueden estar ubicados fuera de Colombia, principalmente en los Estados Unidos. Esto implica la transferencia o transmisión internacional de datos, la cual se realiza con las garantías exigidas por la ley (contratos de transmisión de datos y cláusulas de confidencialidad y seguridad). Entre dichos proveedores se encuentran:",
        en: "To operate the Platform, Medellín Social relies on providers acting as Data Processors that may be located outside Colombia, mainly in the United States. This entails the international transfer or transmission of data, carried out with the safeguards required by law (data transmission agreements and confidentiality and security clauses). Such providers include:",
      },
      {
        tipo: "lista",
        es: [
          "Proveedor de alojamiento e infraestructura en la nube (hosting y bases de datos).",
          "Proveedor de mapas y geolocalización (visualización del mapa).",
          "Proveedor de inicio de sesión federado (Google), cuando el titular usa esa opción.",
          "Proveedor de CRM y automatización de mercadeo (gestión de leads y relación con el titular).",
          "Proveedor de envío de correo electrónico transaccional.",
          "Proveedor de almacenamiento de imágenes.",
          "Proveedor de monitoreo de errores y rendimiento.",
          "Pasarela de pagos, cuando el titular realice transacciones de pago.",
        ],
        en: [
          "Cloud hosting and infrastructure provider (hosting and databases).",
          "Maps and geolocation provider (map display).",
          "Federated sign-in provider (Google), when the subject uses that option.",
          "CRM and marketing automation provider (lead management and relationship with the subject).",
          "Transactional email delivery provider.",
          "Image storage provider.",
          "Error and performance monitoring provider.",
          "Payment gateway, when the subject makes payment transactions.",
        ],
      },
      {
        tipo: "p",
        es: "Medellín Social no vende los datos personales de sus titulares. Solo los comparte con terceros en los casos descritos en esta política, cuando el titular lo autorice (p. ej. al enviar una solicitud de contacto a un agente) o cuando lo exija una autoridad competente.",
        en: "Medellín Social does not sell its subjects' personal data. It only shares them with third parties in the cases described in this policy, when the subject authorizes it (e.g. when sending a contact request to an agent) or when required by a competent authority.",
      },
    ],
  },
  {
    es: "8. Cookies y tecnologías similares",
    en: "8. Cookies and similar technologies",
    bloques: [
      {
        tipo: "p",
        es: "La Plataforma usa cookies y almacenamiento local del navegador para: mantener la sesión del titular, recordar preferencias (idioma, moneda, unidad), habilitar el mapa y medir el uso de forma agregada. El titular puede configurar su navegador para bloquear o eliminar cookies; algunas funciones pueden dejar de operar correctamente si se deshabilitan.",
        en: "The Platform uses cookies and the browser's local storage to: keep the subject's session, remember preferences (language, currency, unit), enable the map and measure usage in aggregate. The subject may configure their browser to block or delete cookies; some features may stop working correctly if they are disabled.",
      },
    ],
  },
  {
    es: "9. Derechos del titular (artículo 8, Ley 1581 de 2012)",
    en: "9. Rights of the data subject (article 8, Law 1581 of 2012)",
    bloques: [
      {
        tipo: "p",
        es: "El titular de los datos tiene derecho a:",
        en: "The data subject has the right to:",
      },
      {
        tipo: "lista",
        es: [
          "Conocer, actualizar y rectificar sus datos personales.",
          "Solicitar prueba de la autorización otorgada.",
          "Ser informado, previa solicitud, sobre el uso que se ha dado a sus datos.",
          "Presentar quejas ante la Superintendencia de Industria y Comercio (SIC) por infracciones a la ley, una vez agotado el trámite de consulta o reclamo ante el Responsable.",
          "Revocar la autorización y/o solicitar la supresión de sus datos, cuando no exista un deber legal o contractual que imponga conservarlos.",
          "Acceder de forma gratuita a sus datos personales que hayan sido objeto de tratamiento.",
        ],
        en: [
          "Know, update and rectify their personal data.",
          "Request proof of the authorization granted.",
          "Be informed, upon request, about the use given to their data.",
          "File complaints with the Superintendence of Industry and Commerce (SIC) for breaches of the law, once the inquiry or claim process before the Controller has been exhausted.",
          "Revoke the authorization and/or request the deletion of their data, when there is no legal or contractual duty to retain it.",
          "Access, free of charge, their personal data that has been processed.",
        ],
      },
    ],
  },
  {
    es: "10. Procedimiento para consultas y reclamos",
    en: "10. Procedure for inquiries and claims",
    bloques: [
      {
        tipo: "p",
        es: "Consultas (artículo 14). El titular podrá consultar sus datos escribiendo a privacidad@medellinsocial.com. La consulta será atendida en un término máximo de diez (10) días hábiles contados desde su recibo. Cuando no sea posible atenderla en ese plazo, se informará al interesado antes de su vencimiento, indicando los motivos y la fecha en que se atenderá, que no superará los cinco (5) días hábiles siguientes.",
        en: "Inquiries (article 14). The subject may consult their data by writing to privacidad@medellinsocial.com. The inquiry will be answered within a maximum of ten (10) business days from its receipt. When this is not possible, the interested party will be informed before the deadline, stating the reasons and the date on which it will be answered, which will not exceed the following five (5) business days.",
      },
      {
        tipo: "p",
        es: "Reclamos (artículo 15). Si el titular considera que sus datos deben ser corregidos, actualizados o suprimidos, o advierte un presunto incumplimiento, podrá presentar un reclamo que debe contener: identificación del titular, descripción de los hechos, dirección de contacto y los documentos de soporte. Si el reclamo resulta incompleto, se requerirá al interesado dentro de los cinco (5) días siguientes para subsanarlo; transcurridos dos (2) meses sin respuesta, se entenderá desistido. El reclamo se resolverá en un término máximo de quince (15) días hábiles contados desde el día siguiente a su recibo; si no fuere posible, se informarán los motivos y la fecha de resolución, que no superará los ocho (8) días hábiles siguientes. Recibido el reclamo completo, se incluirá en la base de datos la leyenda «reclamo en trámite» dentro de los dos (2) días hábiles siguientes.",
        en: "Claims (article 15). If the subject believes their data should be corrected, updated or deleted, or detects a possible breach, they may file a claim containing: the subject's identification, a description of the facts, a contact address and supporting documents. If the claim is incomplete, the interested party will be asked within the following five (5) days to complete it; after two (2) months without a response, it will be deemed withdrawn. The claim will be resolved within a maximum of fifteen (15) business days from the day after its receipt; if not possible, the reasons and the resolution date will be communicated, not exceeding the following eight (8) business days. Once the complete claim is received, the legend «claim in process» will be added to the database within the following two (2) business days.",
      },
    ],
  },
  {
    es: "11. Canal de atención al titular",
    en: "11. Data subject support channel",
    bloques: [
      {
        tipo: "p",
        es: "El área responsable de la atención de consultas, reclamos y solicitudes de los titulares es el área de Protección de Datos de Medellín Social. Canales disponibles:",
        en: "The area responsible for handling subjects' inquiries, claims and requests is the Data Protection area of Medellín Social. Available channels:",
      },
      {
        tipo: "lista",
        es: [
          "Correo electrónico: privacidad@medellinsocial.com.",
          "Teléfono / WhatsApp: [TELÉFONO — POR COMPLETAR].",
          "Dirección física: [DIRECCIÓN — POR COMPLETAR].",
          "Baja de comunicaciones comerciales: desde el enlace incluido en cada correo o escribiendo al canal anterior.",
        ],
        en: [
          "Email: privacidad@medellinsocial.com.",
          "Phone / WhatsApp: [PHONE — TO BE COMPLETED].",
          "Physical address: [ADDRESS — TO BE COMPLETED].",
          "Unsubscribe from commercial communications: via the link included in each email or by writing to the channel above.",
        ],
      },
    ],
  },
  {
    es: "12. Seguridad de la información",
    en: "12. Information security",
    bloques: [
      {
        tipo: "p",
        es: "Medellín Social adopta medidas técnicas, humanas y administrativas razonables para proteger los datos personales contra acceso no autorizado, pérdida, alteración o uso indebido, entre ellas: cifrado de las comunicaciones en tránsito (HTTPS/TLS), almacenamiento de contraseñas mediante funciones de hash, control de acceso a los sistemas, expiración y revocación de sesiones, y minimización de datos. No obstante, ningún sistema es completamente infalible; la seguridad de la información constituye una obligación de medio y no de resultado.",
        en: "Medellín Social adopts reasonable technical, human and administrative measures to protect personal data against unauthorized access, loss, alteration or misuse, including: encryption of communications in transit (HTTPS/TLS), storage of passwords using hashing functions, access control to systems, session expiration and revocation, and data minimization. However, no system is completely infallible; information security is a best-efforts obligation and not an obligation of result.",
      },
    ],
  },
  {
    es: "13. Conservación y vigencia de las bases de datos",
    en: "13. Data retention and database validity",
    bloques: [
      {
        tipo: "p",
        es: "Los datos se conservan durante el tiempo en que exista relación con el titular y mientras sean necesarios para las finalidades autorizadas, así como durante los plazos adicionales que impongan obligaciones legales, contables o tributarias. Cuando el titular revoque la autorización o solicite la supresión y no exista deber legal o contractual de conservación, los datos serán eliminados o anonimizados dentro de los plazos de ley.",
        en: "Data is retained for as long as a relationship with the subject exists and while it is necessary for the authorized purposes, as well as for the additional periods imposed by legal, accounting or tax obligations. When the subject revokes authorization or requests deletion and there is no legal or contractual duty to retain, the data will be deleted or anonymized within the legal time frames.",
      },
    ],
  },
  {
    es: "14. Límites y exclusiones de responsabilidad de Medellín Social",
    en: "14. Limitations and exclusions of liability of Medellín Social",
    bloques: [
      {
        tipo: "p",
        es: "Medellín Social es una plataforma de información e intermediación tecnológica. En consecuencia, y sin perjuicio de sus obligaciones como Responsable del Tratamiento:",
        en: "Medellín Social is an information and technological intermediation platform. Accordingly, and without prejudice to its obligations as Data Controller:",
      },
      {
        tipo: "lista",
        es: [
          "La información de inmuebles proveniente de portales de terceros, de agentes o de anunciantes se presenta «tal como está». Medellín Social no garantiza la exactitud, vigencia, disponibilidad ni legalidad de dichos avisos, precios u ofertas, ni responde por su contenido.",
          "Las estimaciones y métricas (valor estimado, rentabilidad/yields, historial de precio, puntajes, entorno, temperatura del mercado) son de carácter referencial e informativo, se construyen a partir de datos públicos, estadísticos y modelos, y NO constituyen avalúo comercial ni asesoría financiera, de inversión, tributaria, jurídica o inmobiliaria. Las decisiones del titular se adoptan bajo su propia y exclusiva responsabilidad.",
          "Medellín Social no es parte en las negociaciones, contratos o transacciones que se celebren entre usuarios, agentes, agencias o propietarios; no garantiza la idoneidad, veracidad o cumplimiento de los agentes o anunciantes, ni el resultado de visitas o negocios.",
          "Cuando el titular decide compartir sus datos de contacto con un agente, agencia o tercero a través de la Plataforma, dicho tercero actúa como responsable independiente del tratamiento que realice con esa información; Medellín Social no responde por el uso que aquel le dé.",
          "La Plataforma se ofrece sin garantía de disponibilidad ininterrumpida; podrá suspenderse por mantenimiento, causas técnicas o de fuerza mayor.",
          "La Plataforma puede contener enlaces a sitios de terceros cuyo contenido y políticas de privacidad son ajenos a Medellín Social.",
        ],
        en: [
          "Property information from third-party portals, agents or advertisers is presented «as is». Medellín Social does not guarantee the accuracy, validity, availability or legality of such listings, prices or offers, nor is it liable for their content.",
          "Estimates and metrics (estimated value, yields/returns, price history, scores, surroundings, market temperature) are referential and informational, built from public and statistical data and models, and do NOT constitute a commercial appraisal or financial, investment, tax, legal or real estate advice. The subject's decisions are made under their own and exclusive responsibility.",
          "Medellín Social is not a party to the negotiations, contracts or transactions entered into between users, agents, agencies or owners; it does not guarantee the suitability, truthfulness or compliance of agents or advertisers, nor the outcome of visits or deals.",
          "When the subject chooses to share their contact data with an agent, agency or third party through the Platform, that third party acts as an independent controller of the processing it carries out with that information; Medellín Social is not liable for the use it makes of it.",
          "The Platform is offered without a guarantee of uninterrupted availability; it may be suspended due to maintenance, technical causes or force majeure.",
          "The Platform may contain links to third-party sites whose content and privacy policies are outside Medellín Social's control.",
        ],
      },
    ],
  },
  {
    es: "15. Datos de contacto contenidos en avisos de fuentes públicas",
    en: "15. Contact data contained in listings from public sources",
    bloques: [
      {
        tipo: "p",
        es: "La Plataforma agrega e indexa avisos inmobiliarios publicados en fuentes de acceso público. Dichos avisos pueden contener datos de contacto de agentes o anunciantes. El tratamiento de esos datos tiene como única finalidad ofrecer una vista agregada y comparativa del mercado inmobiliario del Valle de Aburrá. El titular de tales datos puede solicitar en cualquier momento su actualización o exclusión a través de los canales de la sección 11.",
        en: "The Platform aggregates and indexes real estate listings published on publicly accessible sources. Such listings may contain contact data of agents or advertisers. The sole purpose of processing that data is to offer an aggregated and comparative view of the Aburrá Valley real estate market. The owner of such data may request its update or exclusion at any time through the channels in section 11.",
      },
    ],
  },
  {
    es: "16. Modificaciones a la política",
    en: "16. Changes to this policy",
    bloques: [
      {
        tipo: "p",
        es: "Medellín Social podrá modificar esta política para adaptarla a cambios normativos, operativos o del servicio. Las modificaciones se publicarán en esta página con su respectiva fecha de vigencia. Cuando los cambios sean sustanciales, se informará a los titulares y, de ser necesario, se solicitará una nueva autorización.",
        en: "Medellín Social may amend this policy to adapt it to regulatory, operational or service changes. Amendments will be published on this page with their respective effective date. When changes are substantial, subjects will be informed and, if necessary, a new authorization will be requested.",
      },
    ],
  },
  {
    es: "17. Vigencia y ley aplicable",
    en: "17. Effective date and applicable law",
    bloques: [
      {
        tipo: "p",
        es: `La presente política rige a partir del ${VIGENCIA.es} y permanecerá vigente mientras Medellín Social desarrolle su objeto. Las bases de datos administradas tendrán la vigencia necesaria para cumplir las finalidades aquí descritas. Esta política se rige por las leyes de la República de Colombia; la autoridad de control en materia de protección de datos personales es la Superintendencia de Industria y Comercio (SIC).`,
        en: `This policy is effective as of ${VIGENCIA.en} and will remain in force while Medellín Social conducts its business. The databases managed will remain valid for as long as necessary to fulfill the purposes described herein. This policy is governed by the laws of the Republic of Colombia; the supervisory authority for personal data protection is the Superintendence of Industry and Commerce (SIC).`,
      },
    ],
  },
];

function PoliticaPrivacidadPage() {
  const { lang } = useLang();
  const en = lang === "en";
  return (
    <BarrioProvider initialSlug="todos">
    <div className="paper-theme" style={{ minHeight: "100dvh", background: "#FAF8F3" }}>
      <ComunidadNavbar />
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px", fontFamily: "'Inter', system-ui, sans-serif", color: "#111418" }}>
        <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: "2rem", fontWeight: 900, margin: "0 0 8px" }}>
          {en ? "Personal Data Processing Policy" : "Política de Tratamiento de Datos Personales"}
        </h1>
        <p style={{ color: "#5B5F5C", fontSize: 14, margin: "0 0 4px" }}>
          Ley 1581 de 2012 · Decreto 1377 de 2013 · Decreto 1074 de 2015
        </p>
        <p style={{ color: "#5B5F5C", fontSize: 13, margin: "0 0 28px" }}>
          {en ? `In force since ${VIGENCIA.en}.` : `Vigente desde el ${VIGENCIA.es}.`}
        </p>

        {SECCIONES.map((s) => (
          <section key={s.es} style={{ marginBottom: 26 }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 800, margin: "0 0 8px" }}>{en ? s.en : s.es}</h2>
            {s.bloques.map((b, i) =>
              b.tipo === "p" ? (
                <p key={i} style={{ fontSize: 14, lineHeight: 1.65, color: "#3a3f3c", margin: "0 0 10px" }}>
                  {en ? b.en : b.es}
                </p>
              ) : (
                <ul key={i} style={{ margin: "0 0 10px", paddingLeft: 20 }}>
                  {(en ? b.en : b.es).map((it, j) => (
                    <li key={j} style={{ fontSize: 14, lineHeight: 1.6, color: "#3a3f3c", marginBottom: 5 }}>
                      {it}
                    </li>
                  ))}
                </ul>
              ),
            )}
          </section>
        ))}

        <p style={{ fontSize: 12, color: "#8a8f8b", marginTop: 32, borderTop: "1px solid #E5E0D5", paddingTop: 16 }}>
          {en
            ? "This policy constitutes the privacy notice and the information processing policy of Medellín Social under Law 1581 of 2012 and its implementing decrees."
            : "Esta política constituye el aviso de privacidad y la política de tratamiento de la información de Medellín Social conforme a la Ley 1581 de 2012 y sus decretos reglamentarios."}
        </p>
      </div>
    </div>
    </BarrioProvider>
  );
}
