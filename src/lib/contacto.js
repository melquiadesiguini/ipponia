// Contacto comercial de IPPONIA: a dónde llegan las solicitudes de acceso.

// Nombre que aparece en el pie de página (© año NOMBRE). Cuando la agencia tenga nombre, se cambia solo acá.
export const NOMBRE_EMPRESA = 'IPPONIA'

// Número de WhatsApp en formato internacional, solo dígitos y sin "+".
// Argentina (celular): 549 + código de área sin 0 + número sin 15. Ej.: 5491122334455
export const WHATSAPP_NUMERO = '5491157462523'

// Mientras no haya número de WhatsApp, las solicitudes llegan por email
export const CONTACTO_EMAIL = 'melquiades.iguini@gmail.com'

const MENSAJE = [
  'Hola! Te escribo desde la página de IPPONIA y quiero contratar el servicio.',
  '',
  'Organización (dojo, club o federación):',
  'Nombre y apellido:',
  'Módulos que necesitamos (Kata, Kumite, Kobudo, Destreza):',
  'Fecha estimada del primer torneo:',
].join('\n')

export const URL_SOLICITUD = WHATSAPP_NUMERO
  ? `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(MENSAJE)}`
  : `mailto:${CONTACTO_EMAIL}?subject=${encodeURIComponent('Quiero contratar IPPONIA')}&body=${encodeURIComponent(MENSAJE)}`

