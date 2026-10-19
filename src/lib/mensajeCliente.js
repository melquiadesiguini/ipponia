// Texto listo para pegar en WhatsApp o en un mail, con los datos de acceso de un cliente.
//   alta (cuenta recién creada): trae email y, si se eligió, la contraseña inicial
//   organización ya existente: solo las direcciones (la contraseña no se guarda en ningún lado)
export function mensajeParaCliente({ nombre, urlDueno, urlUsuarios, email, clave, vence }) {
  const lineas = [`Hola! Estos son los datos de acceso a IPPONIA de ${nombre}:`, '']

  lineas.push(`Ingreso del dueño: ${urlDueno}`)
  if (email) lineas.push(`Email: ${email}`)
  if (clave) {
    lineas.push(`Contraseña inicial: ${clave}`)
    lineas.push('(La primera vez que entres te va a pedir que la cambies.)')
  } else if (email) {
    lineas.push('Te llega una invitación por email para elegir tu contraseña.')
  } else {
    lineas.push('Entrás con el email y la contraseña que te pasamos al crear la cuenta.')
  }

  lineas.push('', `Ingreso de tus usuarios (jueces, mesa, etc.): ${urlUsuarios}`)
  if (vence) lineas.push('', `Tu acceso está vigente hasta el ${vence}.`)
  return lineas.join('\n')
}
