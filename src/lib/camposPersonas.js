// Estructura de las listas que administra el administrador (Configuración).
// Cada campo es una columna de la tabla en la base, del Excel de importación y de la pantalla.
//   clave: columna en la base     etiqueta: título visible
//   encabezado: cómo se reconoce la columna en el Excel     tipo: 'texto' | 'booleano'
//   requerido: no se importa la fila si falta
//   ejemplo: encabezado y filas del Excel de ejemplo que se descarga
export const CAMPOS_PERSONAS = {
  jueces: {
    singular: 'juez',
    plural: 'jueces',
    orden: ['apellido', 'nombre'],
    conflicto: 'organizacion_id,apellido,nombre',
    claveUnica: ['apellido', 'nombre'],
    campos: [
      { clave: 'apellido', etiqueta: 'Apellido', tipo: 'texto', encabezado: /apellido/i },
      { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, encabezado: /^nombre/i },
      { clave: 'certificado', etiqueta: 'Certificado', tipo: 'booleano', encabezado: /certific|habilit/i },
      { clave: 'grado', etiqueta: 'Grado', tipo: 'texto', encabezado: /grado|\bdan\b|kyu/i },
      {
        clave: 'organizacion',
        etiqueta: 'Organización',
        tipo: 'texto',
        encabezado: /organizaci|asociaci|federaci/i,
      },
    ],
    ejemplo: {
      archivo: 'Jueces - ejemplo.xlsx',
      encabezados: ['apellido', 'nombre', 'certificado', 'grado', 'organización'],
      filas: [
        ['Pérez', 'Juan', 'SI', '3° Dan', 'Federación Argentina de Karate'],
        ['Gómez', 'María', 'NO', '2° Dan', 'Budo Kenei Kai'],
      ],
    },
  },
  competidores: {
    singular: 'competidor',
    plural: 'competidores',
    orden: ['nombre'],
    conflicto: 'organizacion_id,nombre',
    claveUnica: ['nombre'],
    campos: [
      { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, encabezado: /nombre|apellido|competidor/i },
      { clave: 'escuela', etiqueta: 'Escuela', tipo: 'texto', encabezado: /escuela|dojo|club|academia|gimnasio/i },
    ],
    ejemplo: {
      archivo: 'Competidores - ejemplo.xlsx',
      encabezados: ['nombre', 'escuela'],
      filas: [
        ['Lucía Fernández', 'Dojo Central'],
        ['Mateo Rossi', 'Dojo Norte'],
      ],
    },
  },
}
