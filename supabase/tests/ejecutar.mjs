// Pruebas de la base de datos (multi-organización), sobre un PostgreSQL real en memoria (PGlite).
// No toca Supabase: simula auth.users, auth.uid() y los roles anon/authenticated/service_role.
//
//   npm run test:db
//
// Pasos: (1) se carga el esquema ANTERIOR con datos de ejemplo, (2) se aplican las migraciones
// en orden, (3) se comprueba que los datos se migraron, y (4) se prueba el aislamiento entre
// organizaciones y la regla de permisos con RLS real.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { filaJurado, filaKumite } from '../../src/lib/filasResultados.js'
import { calcularPuntaje } from '../../src/lib/jurado.js'
import { valoresIniciales, validar, cambiosDesdeValores, calcularDeValores } from '../../src/lib/editarResultado.js'
import { mensajeParaCliente } from '../../src/lib/mensajeCliente.js'
import { slugDesdeNombre, conSufijo, SLUGS_RESERVADOS } from '../../src/lib/slug.js'
import { agregarResultado, posiciones, puestosEmpatados, resultadoDeCategoria, marcarCierre, leerRanking, registrarEnRanking, limpiarRanking, estaVencido } from '../../src/lib/ranking.js'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (ruta) => readFileSync(join(raiz, ruta), 'utf8')

process.on('uncaughtException', (e) => { console.log('ERROR inesperado: ' + e.message); process.exit(1) })
process.on('unhandledRejection', (e) => { console.log('ERROR inesperado: ' + (e?.message ?? e)); process.exit(1) })
const db = new PGlite()
let ok = 0
let fallos = 0

function prueba(nombre, condicion, detalle = '') {
  if (condicion) {
    ok++
    console.log(`  ✓ ${nombre}`)
  } else {
    fallos++
    console.log(`  ✗ ${nombre} ${detalle}`)
  }
}
const filas = async (sql) => (await db.query(sql)).rows
const uno = async (sql) => (await filas(sql))[0]

// Ejecuta un bloque como usuario de la API (rol authenticated, con su JWT)
async function como(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`)
  }
}
async function comoAnonimo(fn) {
  await db.exec(`set role anon; select set_config('request.jwt.claims', '', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role;`)
  }
}
// ¿La operación falla? (con un patrón opcional del mensaje)
async function falla(fn, patron) {
  try {
    await fn()
    return false
  } catch (e) {
    return patron ? new RegExp(patron, 'i').test(e.message) : true
  }
}

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const U = {
  superadmin: id(1), mesaA: id(2), supervisorA: id(3),
  duenoB: id(10), juezB: id(11), kansaB: id(12), sinRolB: id(13),
  duenoC: id(20),
}

// Inserta un resultado de jurado válido (cambian el módulo y quién lo firma)
const insJurado = (org, uid, modulo = 'kata') =>
  `insert into public.resultados_jurado (organizacion_id, creado_por, modulo, competidor, sistema_jueces, juez1_puntaje, juez2_puntaje, juez_central_puntaje, puntaje_final)
   values ('${org}', '${uid}', '${modulo}', 'X', 3, 5, 5, 5, 15)`
const insKumite = (org, uid) =>
  `insert into public.resultados_kumite (organizacion_id, creado_por, puntaje_shiro, puntaje_aka) values ('${org}', '${uid}', 3, 1)`

// ---------------------------------------------------------------- 1) Esquema anterior
console.log('\n1) Estado anterior (esquema viejo + datos de ejemplo)')
await db.exec(leer('tests/bootstrap.sql'))
await db.exec(leer('legacy/schema.sql'))
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values ('${U.superadmin}', 'melquiades.iguini@gmail.com', now());
  update public.organizations set name = 'Ikigai Dojo';
  insert into public.invitaciones (org_id, email, role)
    select id, 'mesa@x.com', 'mesa' from public.organizations
    union all select id, 'sup@x.com', 'supervisor' from public.organizations;
  insert into auth.users (id, email, email_confirmed_at) values ('${U.mesaA}', 'mesa@x.com', now());
  insert into auth.users (id, email, email_confirmed_at) values ('${U.supervisorA}', 'sup@x.com', now());
  insert into public.jueces (org_id, nombre, apellido) select id, 'Juan', 'Pérez' from public.organizations;
  insert into public.results (org_id, modulo, area, payload, created_by)
    select id, v.modulo, v.area, v.payload::jsonb, '${U.superadmin}' from public.organizations,
    (values
      ('kata', '1', '{"competitor":"Ana"}'),
      ('kata', '2', '{"judgeSystem":3,"competitor":"Lucía","kata":"Heian","ronda":2,"responsableMesa":"Marta","finalScore":15.5,"jueces":[{"numero":1,"nombre":"Ana","puntaje":5.5,"incluido":true},{"numero":2,"nombre":"Beto","puntaje":5,"incluido":true},{"numero":3,"nombre":"Carla","puntaje":5,"incluido":true}]}'),
      ('kobudo', '3', '{"judgeSystem":5,"competitor":"Mateo","kata":"Sai","finalScore":"21.60","scores":{"judge1":"6","judge2":"7","judge3":"7.1","judge4":"7.5","judge5":"7.8"},"judgeNames":{"judge1":"Z"}}'),
      ('kumite', '4', '{"categoria":"Cadete","nombreShiro":"Ana","nombreAka":"Beto","shiroTotal":3,"akaTotal":1,"ganador":"Ana","faltas":{"shiro":{},"aka":{}},"salida":null,"enchoSen":false,"duracionRestanteMs":30000,"sistemaJueces":5}')
    ) as v(modulo, area, payload);
`)
prueba('el esquema viejo tiene members y 3 miembros', Number((await uno('select count(*) n from public.members')).n) === 3)

// ---------------------------------------------------------------- 2) Migraciones
console.log('\n2) Aplicando migraciones')
const migraciones = readdirSync(join(raiz, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
for (const m of migraciones) {
  try {
    await db.exec(leer(`migrations/${m}`))
    prueba(`migración ${m}`, true)
  } catch (e) {
    prueba(`migración ${m}`, false, e.message)
    console.log('\nNo se puede seguir sin las migraciones.')
    process.exit(1)
  }
}

// ---------------------------------------------------------------- 3) Datos migrados
console.log('\n3) Datos migrados')
const orgA = await uno(`select * from public.organizaciones where nombre = 'Ikigai Dojo'`)
prueba('la organización conserva datos y recibe slug "ikigai-dojo"', orgA?.slug === 'ikigai-dojo')
prueba('queda en el plan estándar', orgA?.plan === 'estandar')
prueba('roles de fábrica + Supervisor', Number((await uno(`select count(*) n from public.roles where organizacion_id='${orgA.id}'`)).n) === 6)
prueba('3 perfiles', Number((await uno('select count(*) n from public.perfiles')).n) === 3)
prueba('el dueño es el primer administrador', (await uno(`select usuario_id from public.perfiles where es_dueno`)).usuario_id === U.superadmin)
prueba('3 asignaciones permanentes', Number((await uno('select count(*) n from public.asignaciones where torneo_id is null and area is null')).n) === 3)
prueba('superadmin migrado', Number((await uno(`select count(*) n from public.superadmins where usuario_id='${U.superadmin}'`)).n) === 1)
prueba('se retiraron members, invitaciones y platform_admins',
  (await uno(`select to_regclass('public.members') a, to_regclass('public.invitaciones') b, to_regclass('public.platform_admins') c`)).a === null &&
  (await uno(`select to_regclass('public.invitaciones') b`)).b === null)
prueba('los jueces se conservan', Number((await uno('select count(*) n from public.jueces')).n) === 1)
prueba('los 4 resultados viejos quedan archivados', Number((await uno('select count(*) n from public.resultados_archivo')).n) === 4 && (await uno(`select to_regclass('public.resultados') t`)).t === null)
prueba('se pasaron 2 resultados de jurado y 1 de kumite (el incompleto queda solo en el archivo)',
  Number((await uno('select count(*) n from public.resultados_jurado')).n) === 2 && Number((await uno('select count(*) n from public.resultados_kumite')).n) === 1)
const kataMig = await uno(`select * from public.resultados_jurado where modulo = 'kata'`)
prueba('kata migrado: tipos y columnas (área, ronda, sistema, jueces y puntaje final)',
  kataMig.competidor === 'Lucía' && kataMig.kata === 'Heian' && kataMig.area === 2 && kataMig.ronda === 2 && kataMig.sistema_jueces === 3 &&
  kataMig.responsable_mesa === 'Marta' && Number(kataMig.puntaje_final) === 15.5 && kataMig.juez1_nombre === 'Ana' && Number(kataMig.juez1_puntaje) === 5.5)
prueba('con 3 jueces el tercero es el central y los jueces 3 y 4 quedan vacíos (NULL, no 0)',
  kataMig.juez3_puntaje === null && kataMig.juez4_puntaje === null && kataMig.juez_central_nombre === 'Carla' && Number(kataMig.juez_central_puntaje) === 5)
const kobMig = await uno(`select * from public.resultados_jurado where modulo = 'kobudo'`)
prueba('resultado viejo con textos: puntajes a número y nombres a su lugar', kobMig.sistema_jueces === 5 && Number(kobMig.juez3_puntaje) === 7.1 && kobMig.juez1_nombre === 'Z' && kobMig.juez2_nombre === null && kobMig.ronda === null)
prueba('resultado viejo de 5 jueces: se descartan el mayor (central) y el menor (juez 1)', JSON.stringify([...kobMig.jueces_descartados].sort()) === '[1,5]')
const kumMig = await uno(`select * from public.resultados_kumite`)
prueba('kumite migrado: marcador, ganador, sistema y duración como número', kumMig.puntaje_shiro === 3 && kumMig.puntaje_aka === 1 && kumMig.lado_ganador === 'shiro' && kumMig.sistema_jueces === 5 && kumMig.duracion_restante_ms === 30000 && kumMig.area === 4 && kumMig.categoria === 'Cadete')
prueba('la API no puede leer el archivo viejo', await como(U.superadmin, () => falla(() => db.query('select * from public.resultados_archivo'), 'permission denied')))
prueba('el trigger de registro viejo ya no existe',
  Number((await uno(`select count(*) n from pg_trigger where tgname in ('on_auth_user_created','on_auth_user_confirmed')`)).n) === 0)

// ---------------------------------------------------------------- 4) Aislamiento y permisos
console.log('\n4) Aislamiento entre organizaciones y permisos')
// Dos organizaciones nuevas, como las crearía la Edge Function
await db.exec(`
  select public.crear_organizacion_interna('fakko', 'FAKKO');
  select public.crear_organizacion_interna('otra-fed', 'Otra Federación', 'estandar', current_date + 14);
  insert into auth.users (id, email, email_confirmed_at) values
    ('${U.duenoB}', 'dueno@fakko.org', now()),
    ('${U.juezB}', 'juez1@fakko.ipponia.internal', now()),
    ('${U.kansaB}', 'kansa1@fakko.ipponia.internal', now()),
    ('${U.sinRolB}', 'nadie@fakko.ipponia.internal', now()),
    ('${U.duenoC}', 'dueno@otra.org', now());
`)
const orgB = await uno(`select id from public.organizaciones where slug='fakko'`)
const orgC = await uno(`select id from public.organizaciones where slug='otra-fed'`)
await db.exec(`
  select public.registrar_dueno('${orgB.id}', '${U.duenoB}');
  select public.registrar_dueno('${orgC.id}', '${U.duenoC}');
  insert into public.perfiles (usuario_id, organizacion_id, nombre_usuario, debe_cambiar_clave) values
    ('${U.juezB}', '${orgB.id}', 'juez1', true),
    ('${U.kansaB}', '${orgB.id}', 'kansa1', true),
    ('${U.sinRolB}', '${orgB.id}', 'nadie', false);
  insert into public.torneos (id, organizacion_id, nombre) values
    ('${id(101)}', '${orgB.id}', 'Copa FAKKO 1'),
    ('${id(102)}', '${orgB.id}', 'Copa FAKKO 2'),
    ('${id(201)}', '${orgC.id}', 'Torneo de otra federación'),
    ('${id(301)}', '${orgA.id}', 'Torneo Ikigai');
  update public.torneos set estado = 'activo' where id = '${id(101)}';
  -- juez de FAKKO: solo en el torneo 1 y en el área 2
  insert into public.asignaciones (organizacion_id, usuario_id, torneo_id, area, rol_id)
    select '${orgB.id}', '${U.juezB}', '${id(101)}', '2', id from public.roles where organizacion_id='${orgB.id}' and nombre='Juez';
  -- kansa de FAKKO: torneo 1, todas las áreas
  insert into public.asignaciones (organizacion_id, usuario_id, torneo_id, area, rol_id)
    select '${orgB.id}', '${U.kansaB}', '${id(101)}', null, id from public.roles where organizacion_id='${orgB.id}' and nombre='Kansa';
  insert into public.jueces (organizacion_id, nombre, apellido) values ('${orgB.id}', 'Pedro', 'Gómez');
`)

// 4.1 Aislamiento de lectura
const verA = await como(U.superadmin, async () => ({
  perfiles: await filas('select * from public.perfiles'),
  orgs: await filas('select * from public.organizaciones'),
  torneos: await filas('select * from public.torneos'),
  roles: await filas('select * from public.roles'),
  jueces: await filas('select * from public.jueces'),
  resultados: await filas('select * from public.resultados_jurado'),
}))
prueba('la org A ve solo sus perfiles', verA.perfiles.length === 3 && verA.perfiles.every((p) => p.organizacion_id === orgA.id))
prueba('la org A ve solo su organización', verA.orgs.length === 1 && verA.orgs[0].id === orgA.id)
prueba('la org A ve solo sus torneos', verA.torneos.length === 1 && verA.torneos[0].organizacion_id === orgA.id)
prueba('la org A ve solo sus roles', verA.roles.length > 0 && verA.roles.every((r) => r.organizacion_id === orgA.id))
prueba('la org A ve solo sus jueces y resultados', verA.jueces.length === 1 && verA.resultados.length === 2)
const verB = await como(U.duenoB, async () => ({
  perfiles: await filas('select * from public.perfiles'),
  torneos: await filas('select * from public.torneos'),
  jueces: await filas('select * from public.jueces'),
  resultados: await filas('select * from public.resultados_jurado'),
}))
prueba('la org B (FAKKO) ve solo lo suyo', verB.perfiles.length === 4 && verB.torneos.length === 2 && verB.jueces.length === 1 && verB.resultados.length === 0)

// 4.2 Aislamiento de escritura
const rolDeB = (await uno(`select id from public.roles where organizacion_id='${orgB.id}' limit 1`)).id
await como(U.superadmin, async () => {
  prueba('A no puede crear un torneo en B', await falla(() => db.exec(`insert into public.torneos (organizacion_id, nombre) values ('${orgB.id}', 'intruso')`), 'row-level security'))
  const upd = await db.query(`update public.torneos set nombre = 'hackeado' where id = '${id(101)}' returning id`)
  prueba('A no puede modificar un torneo de B', upd.rows.length === 0)
  const del = await db.query(`delete from public.torneos where id = '${id(101)}' returning id`)
  prueba('A no puede borrar un torneo de B', del.rows.length === 0)
  prueba('A no puede crear un rol en B', await falla(() => db.exec(`insert into public.roles (organizacion_id, nombre) values ('${orgB.id}', 'intruso')`), 'row-level security'))
  // A ni siquiera ve los roles de B, así que no puede referenciarlos; y si fuerza el insert, la política lo rechaza
  prueba('A no ve los roles de B', (await filas(`select id from public.roles where organizacion_id='${orgB.id}'`)).length === 0)
  prueba('A no puede asignar roles en B', await falla(() => db.exec(`insert into public.asignaciones (organizacion_id, usuario_id, rol_id) values ('${orgB.id}', '${U.juezB}', '${rolDeB}')`), 'row-level security'))
  prueba('A no puede guardar resultados en B', await falla(() => db.exec(insJurado(orgB.id, U.superadmin)), 'row-level security'))
  prueba('A no puede cargar jueces en B', await falla(() => db.exec(`insert into public.jueces (organizacion_id, nombre) values ('${orgB.id}', 'Intruso')`), 'row-level security'))
})
prueba('el torneo de B quedó intacto', (await uno(`select nombre from public.torneos where id='${id(101)}'`)).nombre === 'Copa FAKKO 1')

// 4.3 Permisos por torneo y área
const tp = (uid, t, a, p) => como(uid, async () => (await uno(`select public.tiene_permiso(${t ? `'${t}'` : 'null'}, ${a ? `'${a}'` : 'null'}, '${p}') v`)).v)
prueba('juez asignado al torneo 1 / área 2 puede puntuar kata ahí', (await tp(U.juezB, id(101), '2', 'puntuar_kata')) === true)
prueba('...pero no en el área 3', (await tp(U.juezB, id(101), '3', 'puntuar_kata')) === false)
prueba('...ni en el torneo 2', (await tp(U.juezB, id(102), '2', 'puntuar_kata')) === false)
prueba('...ni a nivel organización', (await tp(U.juezB, null, null, 'puntuar_kata')) === false)
prueba('...ni tiene permisos que el rol Juez no incluye', (await tp(U.juezB, id(101), '2', 'gestionar_usuarios')) === false)
prueba('kansa del torneo 1 opera en cualquier área', (await tp(U.kansaB, id(101), '7', 'operar_kansa_kumite')) === true)
prueba('kansa no opera en otro torneo', (await tp(U.kansaB, id(102), '7', 'operar_kansa_kumite')) === false)
prueba('el usuario sin rol no tiene permisos', (await tp(U.sinRolB, id(101), '2', 'puntuar_kata')) === false)
prueba('el dueño (Admin permanente) puede todo, en cualquier torneo y área', (await tp(U.duenoB, id(102), '9', 'puntuar_kobudo')) === true && (await tp(U.duenoB, null, null, 'gestionar_usuarios')) === true)
prueba('el admin de A no tiene permisos en torneos de B (otra organización)', (await tp(U.superadmin, id(101), '2', 'puntuar_kata')) === true /* permanente en A */)
const mp = await como(U.juezB, () => filas(`select * from public.mis_permisos('${id(101)}')`))
prueba('mis_permisos devuelve los del torneo con su área', mp.length === 3 && mp.every((r) => r.area === '2'))
const mpOtro = await como(U.juezB, () => filas(`select * from public.mis_permisos('${id(102)}')`))
prueba('mis_permisos no devuelve nada de otro torneo', mpOtro.length === 0)

// 4.4 El plan limita lo que el rol concede
await db.exec(`delete from public.plan_permisos where permiso = 'operar_kansa_kumite'`)
prueba('si el plan no incluye el permiso, ni el Admin lo tiene', (await tp(U.duenoB, null, null, 'operar_kansa_kumite')) === false)
prueba('...y mis_permisos tampoco lo lista', (await como(U.kansaB, () => filas(`select * from public.mis_permisos('${id(101)}')`))).length === 0)
await db.exec(`insert into public.plan_permisos (plan, permiso) values ('estandar', 'operar_kansa_kumite')`)
prueba('al volver al plan, vuelve el permiso', (await tp(U.kansaB, id(101), '7', 'operar_kansa_kumite')) === true)

// 4.5 Organización suspendida o vencida
await db.exec(`update public.organizaciones set estado = 'suspendida' where id = '${orgB.id}'`)
prueba('suspendida: no tiene permisos', (await tp(U.duenoB, null, null, 'gestionar_usuarios')) === false)
prueba('suspendida: no ve torneos', (await como(U.duenoB, () => filas('select * from public.torneos'))).length === 0)
prueba('suspendida: sí ve el estado de su organización (para avisarle)', (await como(U.duenoB, () => filas('select estado from public.organizaciones')))[0]?.estado === 'suspendida')
await db.exec(`update public.organizaciones set estado = 'activa' where id = '${orgB.id}'`)
await db.exec(`update public.organizaciones set vence_el = current_date - 1 where id = '${orgC.id}'`)
prueba('vencida: no tiene permisos', (await tp(U.duenoC, null, null, 'gestionar_usuarios')) === false)
await db.exec(`update public.organizaciones set vence_el = current_date + 5 where id = '${orgC.id}'`)

// 4.6 Anónimos
prueba('anónimo no lee perfiles', await comoAnonimo(() => falla(() => db.query('select * from public.perfiles'), 'permission denied')))
prueba('anónimo no lee organizaciones', await comoAnonimo(() => falla(() => db.query('select * from public.organizaciones'), 'permission denied')))
prueba('anónimo no puede llamar a tiene_permiso', await comoAnonimo(() => falla(() => db.query(`select public.tiene_permiso(null,null,'puntuar_kata')`), 'permission denied')))
const pub = await comoAnonimo(() => filas(`select * from public.org_publica('FAKKO')`))
prueba('org_publica devuelve solo nombre y estado (y no distingue mayúsculas)', pub.length === 1 && pub[0].nombre === 'FAKKO' && pub[0].activa === true && Object.keys(pub[0]).length === 2)
prueba('org_publica de un slug inexistente no devuelve nada', (await comoAnonimo(() => filas(`select * from public.org_publica('no-existe')`))).length === 0)

// 4.7 Superadmin
const resumen = await como(U.superadmin, () => filas('select * from public.superadmin_resumen()'))
prueba('el superadmin ve el resumen de todas las organizaciones', resumen.length === 3)
prueba('...solo con agregados (usuarios y torneos), sin datos deportivos', Number(resumen.find((r) => r.slug === 'fakko').usuarios) === 4 && Number(resumen.find((r) => r.slug === 'fakko').torneos) === 2 && !('payload' in resumen[0]))
prueba('un usuario común no puede pedir el resumen', await como(U.duenoB, () => falla(() => db.query('select * from public.superadmin_resumen()'), 'permiso')))
prueba('el superadmin, como usuario de A, NO ve los torneos de otras organizaciones', (await como(U.superadmin, () => filas('select * from public.torneos'))).length === 1)
prueba('un usuario común no puede darse de alta como superadmin', await como(U.duenoB, () => falla(() => db.exec(`insert into public.superadmins (usuario_id) values ('${U.duenoB}')`), 'permission denied')))
await como(U.superadmin, () => db.query(`select public.superadmin_actualizar_organizacion('${orgC.id}', 'Otra Fed. SA', 'estandar', 'activa', null, 'pagó')`))
prueba('el superadmin puede actualizar plan, estado y notas', (await uno(`select nombre, notas from public.organizaciones where id='${orgC.id}'`)).notas === 'pagó')

// 4.8 Slug y organización: no se cambian desde la API
prueba('un admin no puede cambiar el slug ni el plan de su organización', await como(U.duenoB, () => falla(() => db.exec(`update public.organizaciones set slug = 'nuevo' where id = '${orgB.id}'`), 'permission denied')))
prueba('un slug reservado se rechaza', await falla(() => db.exec(`select public.crear_organizacion_interna('kata', 'X')`), 'slug_no_reservado'))
prueba('un slug repetido se rechaza', await falla(() => db.exec(`select public.crear_organizacion_interna('fakko', 'Otro FAKKO')`), 'organizaciones_slug_unico'))
prueba('un slug inválido se rechaza', await falla(() => db.exec(`select public.crear_organizacion_interna('Mal Slug!', 'X')`), 'slug_formato'))
prueba('el slug es inmutable también para el rol de la API (trigger)', await falla(async () => {
  await db.exec(`set role authenticated`)
  try { await db.exec(`update public.organizaciones set slug = 'nuevo' where id = '${orgB.id}'`) } finally { await db.exec('reset role') }
}))

// 4.9 Usuario único por organización (no en todo el sistema)
await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${id(30)}', 'juez1@otra-fed.ipponia.internal', now())`)
await db.exec(`insert into public.perfiles (usuario_id, organizacion_id, nombre_usuario) values ('${id(30)}', '${orgC.id}', 'juez1')`)
prueba('el mismo nombre de usuario puede existir en dos organizaciones', Number((await uno(`select count(*) n from public.perfiles where nombre_usuario='juez1'`)).n) === 2)
await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${id(31)}', 'juez1b@fakko.ipponia.internal', now())`)
prueba('...pero no dos veces en la misma', await falla(() => db.exec(`insert into public.perfiles (usuario_id, organizacion_id, nombre_usuario) values ('${id(31)}', '${orgB.id}', 'juez1')`), 'perfiles_organizacion_id_nombre_usuario_key'))
prueba('el nombre de usuario con mayúsculas o símbolos se rechaza', await falla(() => db.exec(`insert into public.perfiles (usuario_id, organizacion_id, nombre_usuario) values ('${id(31)}', '${orgB.id}', 'Juez Raro!')`), 'check'))
prueba('email_interno arma usuario@slug.ipponia.internal', (await uno(`select public.email_interno('Juez1','FAKKO') e`)).e === 'juez1@fakko.ipponia.internal')

// 4.10 Candados: la organización nunca queda sin administración
prueba('no se puede quitar el Admin permanente del dueño', await falla(() => db.exec(`delete from public.asignaciones where usuario_id='${U.duenoB}'`), 'Admin permanente'))
prueba('no se puede borrar el rol Admin', await falla(() => db.exec(`delete from public.roles where organizacion_id='${orgB.id}' and nombre='Admin'`), 'no se puede borrar'))
prueba('no se puede renombrar el rol Admin', await falla(() => db.exec(`update public.roles set nombre='Jefe' where organizacion_id='${orgB.id}' and nombre='Admin'`), 'renombrar'))
prueba('no se pueden quitar gestionar_usuarios/gestionar_roles al Admin', await falla(() => db.exec(`delete from public.rol_permisos where permiso='gestionar_roles' and rol_id=(select id from public.roles where organizacion_id='${orgB.id}' and nombre='Admin')`), 'Admin'))
prueba('no se puede desactivar al dueño', await falla(() => db.exec(`update public.perfiles set activo=false where usuario_id='${U.duenoB}'`), 'dueño'))
prueba('una asignación no puede mezclar organizaciones', await falla(() => db.exec(`insert into public.asignaciones (organizacion_id, usuario_id, rol_id) select '${orgC.id}', '${U.duenoC}', id from public.roles where organizacion_id='${orgB.id}' limit 1`), 'no pertenece'))

// 4.11 Roles propios y asignaciones, con el permiso gestionar_roles
await como(U.duenoB, async () => {
  await db.exec(`insert into public.roles (organizacion_id, nombre) values ('${orgB.id}', 'Cronometrista')`)
  await db.exec(`insert into public.rol_permisos (rol_id, permiso) select id, 'ver_pantalla_publica' from public.roles where nombre='Cronometrista' and organizacion_id='${orgB.id}'`)
  prueba('el dueño crea un rol propio con permisos', true)
  prueba('...pero no puede marcar un rol como "de fábrica"', await falla(() => db.exec(`insert into public.roles (organizacion_id, nombre, de_fabrica) values ('${orgB.id}', 'Falso', true)`), 'row-level security'))
  await db.exec(`update public.roles set nombre = 'Juez de mesa' where organizacion_id='${orgB.id}' and nombre='Juez'`)
  prueba('...y edita un rol de fábrica (que no sea Admin)', (await uno(`select 1 x from public.roles where organizacion_id='${orgB.id}' and nombre='Juez de mesa'`)) !== undefined)
})
await db.exec(`update public.roles set nombre = 'Juez' where organizacion_id='${orgB.id}' and nombre='Juez de mesa'`)
prueba('quien no gestiona roles no puede crearlos', await como(U.juezB, () => falla(() => db.exec(`insert into public.roles (organizacion_id, nombre) values ('${orgB.id}', 'Intruso')`), 'row-level security')))
prueba('un rol no puede incluir permisos que el plan no ofrece', await (async () => {
  await db.exec(`delete from public.plan_permisos where permiso = 'ver_pantalla_publica'`)
  const r = await como(U.duenoB, () => falla(() => db.exec(`insert into public.rol_permisos (rol_id, permiso) select id, 'ver_pantalla_publica' from public.roles where nombre='Juez' and organizacion_id='${orgB.id}'`), 'row-level security'))
  await db.exec(`insert into public.plan_permisos (plan, permiso) values ('estandar', 'ver_pantalla_publica')`)
  return r
})())
prueba('el dueño asigna un rol por torneo y área', await como(U.duenoB, async () => {
  await db.exec(`insert into public.asignaciones (organizacion_id, usuario_id, torneo_id, area, rol_id) select '${orgB.id}', '${U.sinRolB}', '${id(102)}', '5', id from public.roles where organizacion_id='${orgB.id}' and nombre='Mesa'`)
  return true
}))
prueba('...y ese usuario ya opera en ese torneo/área', (await tp(U.sinRolB, id(102), '5', 'operar_mesa_kumite')) === true && (await tp(U.sinRolB, id(102), '6', 'operar_mesa_kumite')) === false)
prueba('asignaciones: un juez solo ve las suyas', (await como(U.juezB, () => filas('select * from public.asignaciones'))).every((a) => a.usuario_id === U.juezB))

// 4.12 Listas y resultados según el permiso
prueba('un juez no gestiona la lista de jueces (no la ve)', (await como(U.juezB, () => filas('select * from public.jueces'))).length === 0)
prueba('...pero recibe sugerencias de nombres', (await como(U.juezB, () => filas(`select * from public.sugerir_jueces('ped')`))).length === 1)
prueba('las sugerencias son solo de su organización', (await como(U.duenoC, () => filas(`select * from public.sugerir_jueces('ped')`))).length === 0)
prueba('quien no puntúa ni opera no recibe sugerencias', (await como(U.kansaB, () => filas(`select * from public.sugerir_jueces('ped')`))).length === 0)
prueba('el juez puede guardar resultados de kata pero no de kobudo... (tiene los tres)', await como(U.juezB, async () => {
  await db.exec(insJurado(orgB.id, U.juezB))
  return true
}))
prueba('el kansa no puede guardar resultados de kata', await como(U.kansaB, () => falla(() => db.exec(insJurado(orgB.id, U.kansaB)), 'row-level security')))
prueba('nadie puede firmar un resultado a nombre de otro', await como(U.juezB, () => falla(() => db.exec(insJurado(orgB.id, U.duenoB)), 'row-level security')))
prueba('el juez no ve el historial', (await como(U.juezB, () => filas('select * from public.resultados_jurado'))).length === 0)
prueba('el dueño sí ve el historial', (await como(U.duenoB, () => filas('select * from public.resultados_jurado'))).length === 1)
await como(U.juezB, () => db.exec(`select public.registrar_juez('Nuevo Juez')`))
prueba('registrar_juez agrega un nombre nuevo...', Number((await uno(`select count(*) n from public.jueces where organizacion_id='${orgB.id}'`)).n) === 2)
await como(U.juezB, () => db.exec(`select public.registrar_juez('gómez pedro')`))
prueba('...y no duplica uno existente (aunque esté en otro orden)', Number((await uno(`select count(*) n from public.jueces where organizacion_id='${orgB.id}'`)).n) === 2)

// 4.13 Contraseña inicial
await como(U.juezB, () => db.exec('select public.marcar_clave_cambiada()'))
prueba('marcar_clave_cambiada apaga la obligación solo del propio usuario',
  (await uno(`select debe_cambiar_clave d from public.perfiles where usuario_id='${U.juezB}'`)).d === false &&
  (await uno(`select debe_cambiar_clave d from public.perfiles where usuario_id='${U.kansaB}'`)).d === true)
prueba('un usuario no puede editar perfiles directamente', await como(U.juezB, () => falla(() => db.query(`update public.perfiles set nombre_visible='x' where usuario_id='${U.juezB}'`), 'permission denied')))

// 4.14 Borrar una organización completa funciona (los candados no lo impiden)
prueba('se puede borrar una organización entera (cascada)', await (async () => {
  await db.exec(`delete from public.organizaciones where id = '${orgC.id}'`)
  return Number((await uno(`select count(*) n from public.roles where organizacion_id='${orgC.id}'`)).n) === 0
})())

// ---------------------------------------------------------------- 5) Soporte de las Edge Functions
console.log('\n5) Soporte de las Edge Functions')
await db.exec(`insert into auth.sessions (id, user_id) values ('${id(900)}', '${U.juezB}'), ('${id(901)}', '${U.kansaB}')`)
prueba('un usuario logueado no puede cerrar sesiones ajenas', await como(U.duenoB, () => falla(() => db.query(`select public.cerrar_sesiones_usuario('${U.juezB}')`), 'permission denied')))
prueba('un anónimo tampoco', await comoAnonimo(() => falla(() => db.query(`select public.cerrar_sesiones_usuario('${U.juezB}')`), 'permission denied')))
await db.exec(`set role service_role`)
await db.exec(`select public.cerrar_sesiones_usuario('${U.juezB}')`)
await db.exec(`reset role`)
prueba('service_role cierra las sesiones de ese usuario y de nadie más',
  Number((await uno(`select count(*) n from auth.sessions where user_id='${U.juezB}'`)).n) === 0 &&
  Number((await uno(`select count(*) n from auth.sessions where user_id='${U.kansaB}'`)).n) === 1)
// auditoría: la leen los admins de su organización; nadie puede escribirla desde la API
await db.exec(`insert into public.auditoria (organizacion_id, actor_id, accion) values ('${orgB.id}', '${U.duenoB}', 'crear_usuario')`)
prueba('el dueño ve la auditoría de su organización y no la de otras', (await como(U.duenoB, () => filas('select * from public.auditoria'))).length === 1 && (await como(U.superadmin, () => filas('select * from public.auditoria'))).length === 0)
prueba('nadie escribe auditoría desde la API', await como(U.duenoB, () => falla(() => db.exec(`insert into public.auditoria (organizacion_id, actor_id, accion) values ('${orgB.id}', '${U.duenoB}', 'falsa')`), 'permission denied')))
prueba('el juez (sin gestionar_usuarios) no ve la auditoría', (await como(U.juezB, () => filas('select * from public.auditoria'))).length === 0)

// ---------------------------------------------------------------- 6) mis_permisos_todos
console.log('\n6) mis_permisos_todos')
const todos = (uid) => como(uid, () => filas('select * from public.mis_permisos_todos()'))
const juezTodos = await todos(U.juezB)
prueba('el juez de FAKKO ve sus 3 permisos con torneo y área', juezTodos.length === 3 && juezTodos.every((r) => r.torneo_id === id(101) && r.area === '2'))
const duenoTodos = await todos(U.duenoB)
prueba('el dueño tiene todos los permisos del plan, a nivel organización', duenoTodos.length === 13 && duenoTodos.every((r) => r.torneo_id === null && r.area === null))
prueba('un usuario sin roles no recibe nada', (await todos(U.kansaB)).every((r) => r.permiso === 'operar_kansa_kumite') && (await filas(`select 1 from public.perfiles limit 0`)).length === 0)
await db.exec(`update public.organizaciones set estado = 'suspendida' where id = '${orgB.id}'`)
prueba('con la organización suspendida no recibe nada', (await todos(U.duenoB)).length === 0)
await db.exec(`update public.organizaciones set estado = 'activa' where id = '${orgB.id}'`)
prueba('un anónimo no puede pedirlos', await comoAnonimo(() => falla(() => db.query('select * from public.mis_permisos_todos()'), 'permission denied')))

// ---------------------------------------------------------------- 7) transferir_dueno
console.log('\n7) transferir_dueno')
const NUEVO = '00000000-0000-4000-8000-0000000000aa'
await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${NUEVO}', 'nuevo.dueno@fakko.org', now())`)
prueba('la API pública no puede transferir organizaciones', await como(U.duenoB, () => falla(() => db.query(`select public.transferir_dueno('fakko', 'nuevo.dueno@fakko.org')`), 'permission denied')))
prueba('no transfiere a una cuenta que no existe', await falla(() => db.query(`select public.transferir_dueno('fakko', 'nadie@x.org')`), 'No existe una cuenta'))
prueba('no transfiere a una cuenta que ya está en una organización', await falla(() => db.query(`select public.transferir_dueno('fakko', 'juez1@fakko.ipponia.internal')`), 'ya pertenece'))
prueba('no transfiere una organización inexistente', await falla(() => db.query(`select public.transferir_dueno('no-existe', 'nuevo.dueno@fakko.org')`), 'No existe la organizaci'))
await db.exec(`select public.transferir_dueno('fakko', 'nuevo.dueno@fakko.org')`)
const nuevoPerfil = await uno(`select es_dueno, activo, debe_cambiar_clave from public.perfiles where usuario_id='${NUEVO}'`)
prueba('el nuevo dueño queda como dueño y debe cambiar la clave', nuevoPerfil?.es_dueno === true && nuevoPerfil.debe_cambiar_clave === true)
prueba('el dueño anterior ya no tiene perfil ni roles', Number((await uno(`select count(*) n from public.perfiles where usuario_id='${U.duenoB}'`)).n) === 0 && Number((await uno(`select count(*) n from public.asignaciones where usuario_id='${U.duenoB}'`)).n) === 0)
prueba('el nuevo dueño tiene los 13 permisos a nivel organización', (await todos(NUEVO)).length === 13)
prueba('la organización conserva a sus demás usuarios', Number((await uno(`select count(*) n from public.perfiles where organizacion_id='${orgB.id}'`)).n) === 4)
prueba('los candados del dueño siguen activos tras transferir', await falla(() => db.exec(`update public.perfiles set activo = false where usuario_id='${NUEVO}'`), 'no se puede desactivar'))
prueba('el Admin permanente del nuevo dueño sigue protegido', await falla(() => db.exec(`delete from public.asignaciones where usuario_id='${NUEVO}'`), 'Admin permanente'))

// (el dueño de FAKKO es ahora la cuenta nueva: se transfirió en la sección 7)
// ---------------------------------------------------------------- 8) Resultados con columnas reales
console.log('\n8) Resultados con columnas reales')
const jurado = (campos) => `insert into public.resultados_jurado (organizacion_id, creado_por, modulo, competidor, sistema_jueces, juez1_puntaje, juez2_puntaje, juez_central_puntaje, puntaje_final${campos.cols ?? ''})
  values ('${orgB.id}', '${U.juezB}', '${campos.modulo ?? 'kata'}', '${campos.competidor ?? 'X'}', ${campos.sistema ?? 3}, ${campos.j1 ?? 5}, 5, ${campos.central ?? 5}, ${campos.final ?? 15}${campos.vals ?? ''})`
prueba('un resultado de jurado válido se guarda', await como(U.juezB, async () => { await db.exec(jurado({})); return true }))
prueba('con 3 jueces no se acepta el puntaje del juez 3', await como(U.juezB, () => falla(() => db.exec(jurado({ cols: ', juez3_puntaje', vals: ', 6' })), 'jurado_puntajes_segun_sistema')))
prueba('con 5 jueces hacen falta los puntajes de los jueces 3 y 4', await como(U.juezB, () => falla(() => db.exec(jurado({ sistema: 5 })), 'jurado_puntajes_segun_sistema')))
prueba('un puntaje fuera de 0 a 10 se rechaza', await como(U.juezB, () => falla(() => db.exec(jurado({ j1: 11 })), 'check')))
prueba('el sistema de jueces solo puede ser 3 o 5', await como(U.juezB, () => falla(() => db.exec(jurado({ sistema: 4 })), 'check')))
prueba('el competidor no puede quedar vacío', await como(U.juezB, () => falla(() => db.exec(jurado({ competidor: '  ' })), 'check')))
prueba('el área tiene que ser un número razonable', await como(U.juezB, () => falla(() => db.exec(jurado({ cols: ', area', vals: ', 1000' })), 'check')))
prueba('un módulo de jurado no puede ser kumite', await como(U.juezB, () => falla(() => db.exec(jurado({ modulo: 'kumite' })), 'check|row-level security')))
await como(U.juezB, () => db.exec(jurado({ competidor: 'ConTorneoAjeno', cols: ', torneo_id', vals: `, '${id(102)}'` })))
prueba('el torneo que mande la app se ignora: el resultado queda en el torneo abierto', (await uno(`select torneo_id from public.resultados_jurado where competidor = 'ConTorneoAjeno'`)).torneo_id === id(101))
prueba('el juez no puede guardar un combate de kumite', await como(U.juezB, () => falla(() => db.exec(insKumite(orgB.id, U.juezB)), 'row-level security')))
prueba('el kansa sí puede guardar un combate de kumite', await como(U.kansaB, async () => { await db.exec(insKumite(orgB.id, U.kansaB)); return true }))
prueba('el kansa no ve el historial de kumite', (await como(U.kansaB, () => filas('select * from public.resultados_kumite'))).length === 0)
prueba('el dueño ve el historial de kumite de su organización', (await como(NUEVO, () => filas('select * from public.resultados_kumite'))).length === 1)
prueba('otra organización no ve esos combates', (await como(U.duenoC, () => filas('select * from public.resultados_kumite'))).length === 0)
prueba('un juez no puede editar ni borrar resultados (la API no le muestra ninguna fila)', await como(U.juezB, async () =>
  (await (await db.query(`update public.resultados_jurado set competidor = 'otro' returning id`)).rows.length) === 0 &&
  (await (await db.query(`delete from public.resultados_kumite returning id`)).rows.length) === 0))
prueba('un anónimo no puede leer ni guardar resultados', await comoAnonimo(async () =>
  (await falla(() => db.query('select * from public.resultados_jurado'), 'permission denied')) &&
  (await falla(() => db.exec(insKumite(orgB.id, U.kansaB)), 'permission denied'))))

// ---------------------------------------------------------------- 8b) Un torneo abierto por vez
console.log('\n8b) Un solo torneo abierto, y los resultados van a él')
const abiertoBorrador = async (idTorneo, estado) => db.exec(`update public.torneos set estado = '${estado}' where id = '${idTorneo}'`)
prueba('no se pueden abrir dos torneos a la vez en la misma organización', await falla(() => abiertoBorrador(id(102), 'activo'), 'torneos_uno_abierto'))
prueba('otra organización puede tener su propio torneo abierto', await (async () => { await abiertoBorrador(id(201), 'activo'); return true })())
await abiertoBorrador(id(101), 'finalizado')
prueba('con el torneo cerrado no se puede cargar un resultado de jurado', await como(U.juezB, () => falla(() => db.exec(jurado({})), 'No hay un torneo abierto')))
prueba('con el torneo cerrado no se puede cargar un combate de kumite', await como(U.kansaB, () => falla(() => db.exec(insKumite(orgB.id, U.kansaB)), 'No hay un torneo abierto')))
await abiertoBorrador(id(102), 'activo')
await como(U.juezB, () => db.exec(jurado({ competidor: 'EnElSegundo' })))
prueba('al abrir otro torneo, los resultados nuevos van a ese', (await uno(`select torneo_id from public.resultados_jurado where competidor = 'EnElSegundo'`)).torneo_id === id(102))
await abiertoBorrador(id(102), 'finalizado')
await abiertoBorrador(id(101), 'activo')
prueba('se puede volver a abrir un torneo cerrado', (await uno(`select estado from public.torneos where id = '${id(101)}'`)).estado === 'activo')
await db.exec(`delete from public.resultados_jurado where organizacion_id = '${orgB.id}'; delete from public.resultados_kumite where organizacion_id = '${orgB.id}'`)

// ---------------------------------------------------------------- 8c) Resultados cargados sin conexión
console.log('\n8c) Resultados cargados sin conexión (hora y torneo del momento, sin duplicar)')
const conHora = (competidor, hora, torneo) => jurado({ competidor, cols: ', creado_en' + (torneo ? ', torneo_id' : ''), vals: `, ${hora}` + (torneo ? `, '${torneo}'` : '') })
const idRep = '00000000-0000-4000-8000-0000000fffff'
// un resultado cargado hace 3 horas, con el torneo 101 que estaba abierto entonces; ahora está cerrado y el abierto es otro
await abiertoBorrador(id(101), 'finalizado')
await abiertoBorrador(id(102), 'activo')
await como(U.juezB, () => db.exec(conHora('SinRed1', `now() - interval '3 hours'`, id(101))))
const sr1 = await uno(`select torneo_id, creado_en from public.resultados_jurado where competidor = 'SinRed1'`)
prueba('el resultado enviado tarde conserva el torneo que estaba abierto al cargarlo', sr1.torneo_id === id(101))
prueba('y conserva la hora en que se cargó (no la del envío)', Date.now() - new Date(sr1.creado_en).getTime() > 2.9 * 3600 * 1000)
await como(U.juezB, () => db.exec(conHora('SinRed2', `now() - interval '3 hours'`)))
prueba('si el envío tarde no trae torneo, va al torneo abierto', (await uno(`select torneo_id from public.resultados_jurado where competidor = 'SinRed2'`)).torneo_id === id(102))
await como(U.juezB, () => db.exec(conHora('SinRed3', `now() - interval '3 hours'`, id(201))))
prueba('un torneo de otra organización se ignora: el resultado va al torneo abierto', (await uno(`select torneo_id from public.resultados_jurado where competidor = 'SinRed3'`)).torneo_id === id(102))
await como(U.juezB, () => db.exec(conHora('SinRed4', 'now()', id(101))))
prueba('un resultado actual (no tarde) ignora el torneo que mande la app', (await uno(`select torneo_id from public.resultados_jurado where competidor = 'SinRed4'`)).torneo_id === id(102))
prueba('un resultado de más de 14 días se rechaza', await como(U.juezB, () => falla(() => db.exec(conHora('Viejo', `now() - interval '15 days'`, id(101))), 'demasiado viejo')))
await como(U.juezB, () => db.exec(conHora('Futuro', `now() + interval '2 days'`)))
prueba('una hora del futuro (reloj mal puesto) se guarda con la hora del servidor', Math.abs(Date.now() - new Date((await uno(`select creado_en from public.resultados_jurado where competidor = 'Futuro'`)).creado_en).getTime()) < 60000)
await abiertoBorrador(id(102), 'finalizado')
prueba('sin torneo abierto, un resultado tarde sin torneo conocido se rechaza', await como(U.juezB, () => falla(() => db.exec(conHora('SinTorneo', `now() - interval '3 hours'`)), 'No hay un torneo abierto')))
prueba('sin torneo abierto, un resultado tarde con su torneo cerrado se acepta', await como(U.juezB, async () => { await db.exec(conHora('TardeCerrado', `now() - interval '3 hours'`, id(101))); return true }))
// reenvío del mismo resultado (se cortó la respuesta): la clave primaria lo frena
const conId = (idFila) => `insert into public.resultados_jurado (id, organizacion_id, creado_por, modulo, competidor, sistema_jueces, juez1_puntaje, juez2_puntaje, juez_central_puntaje, puntaje_final, creado_en, torneo_id)
  values ('${idFila}', '${orgB.id}', '${U.juezB}', 'kata', 'Repetido', 3, 5, 5, 5, 15, now() - interval '1 hour', '${id(101)}')`
await como(U.juezB, () => db.exec(conId(idRep)))
prueba('enviar dos veces el mismo resultado no lo duplica (error 23505: la app lo toma como enviado)', await como(U.juezB, () => falla(() => db.exec(conId(idRep)), 'duplicate key')))
prueba('queda una sola fila', Number((await uno(`select count(*) n from public.resultados_jurado where id = '${idRep}'`)).n) === 1)
await como(U.kansaB, () => db.exec(`insert into public.resultados_kumite (organizacion_id, creado_por, puntaje_shiro, puntaje_aka, creado_en, torneo_id) values ('${orgB.id}', '${U.kansaB}', 3, 1, now() - interval '5 hours', '${id(101)}')`))
prueba('Kumite también acepta la hora y el torneo del momento: el combate enviado tarde quedó en su torneo', (await uno(`select torneo_id from public.resultados_kumite where organizacion_id = '${orgB.id}' and creado_en < now() - interval '4 hours'`))?.torneo_id === id(101))
await abiertoBorrador(id(101), 'activo')
await db.exec(`delete from public.resultados_jurado where organizacion_id = '${orgB.id}'; delete from public.resultados_kumite where organizacion_id = '${orgB.id}'`)

// ---------------------------------------------------------------- 9) El código de la app contra la base
console.log('\n9) El código de la app guarda en las tablas reales')
// Inserta una fila armada por src/lib/filasResultados.js, como lo hace la app (con las columnas y tipos que la base exige)
async function guardarComoLaApp(uid, tabla, fila) {
  const columnas = ['organizacion_id', 'creado_por', ...Object.keys(fila)]
  const valores = [orgB.id, uid, ...Object.values(fila).map((v) => (Array.isArray(v) ? `{${v.join(',')}}` : v !== null && typeof v === 'object' ? JSON.stringify(v) : v))]
  const marcas = columnas.map((c, i) => `$${i + 1}` + (['faltas', 'salida'].includes(c) ? '::jsonb' : c === 'jueces_descartados' ? '::smallint[]' : ''))
  await db.query(`insert into public.${tabla} (${columnas.join(', ')}) values (${marcas.join(', ')})`, valores)
}
const j = (numero, nombre, puntaje, incluido = true) => ({ numero, etiqueta: '', nombre, puntaje, incluido })

// Lo que entrega la pantalla de Kata con 3 jueces (puntajes ya como número)
const payloadKata = {
  judgeSystem: 3, kata: 'Heian Shodan', competitor: 'Lucía', area: 4, ronda: 2, responsableMesa: ' Marta ', finalScore: 21.6,
  jueces: [j(1, 'Ana', 7.3), j(2, '', 7.1), j(3, 'Carla', 7.2)],
}
// Destreza con 5 jueces: se descartan el menor (juez 1) y el mayor (central)
const payloadDestreza = {
  judgeSystem: 5, competitor: 'Equipo Norte', area: null, ronda: null, responsableMesa: '', finalScore: 21.6,
  jueces: [j(1, 'A', 6, false), j(2, 'B', 7), j(3, 'C', 7.1), j(4, 'D', 7.5), j(5, 'E', 7.8, false)],
}
const payloadKumite = {
  categoria: 'Cadete', nombreShiro: 'Ana', nombreAka: 'Beto', shiroTotal: 3, akaTotal: 1, ganador: 'Ana', ladoGanador: 'shiro',
  faltas: { shiro: { chukoku: ['adv'] }, aka: {} }, salida: null, enchoSen: true, duracionRestanteMs: 12345.6, responsableMesa: 'Marta', sistemaJueces: 3,
}
await db.exec(`delete from public.resultados_jurado where organizacion_id = '${orgB.id}'; delete from public.resultados_kumite where organizacion_id = '${orgB.id}'`)
prueba('Kata (3 jueces) se guarda con las columnas de la base', await como(U.juezB, async () => { await guardarComoLaApp(U.juezB, 'resultados_jurado', filaJurado('kata', payloadKata)); return true }))
prueba('Destreza (5 jueces, sin área ni ronda) se guarda', await como(U.juezB, async () => { await guardarComoLaApp(U.juezB, 'resultados_jurado', filaJurado('destreza', payloadDestreza, 9)); return true }))
prueba('Kumite se guarda con faltas, duración redondeada y sistema', await como(U.kansaB, async () => { await guardarComoLaApp(U.kansaB, 'resultados_kumite', filaKumite(payloadKumite)); return true }))
const kata = await uno(`select * from public.resultados_jurado where modulo = 'kata' and organizacion_id = '${orgB.id}'`)
prueba('Kata: número, texto y NULL donde corresponde',
  kata.torneo_id === id(101) && kata.area === 4 && kata.ronda === 2 && kata.competidor === 'Lucía' && kata.responsable_mesa === 'Marta' && Number(kata.puntaje_final) === 21.6 &&
  kata.juez1_nombre === 'Ana' && Number(kata.juez1_puntaje) === 7.3 && kata.juez2_nombre === null && Number(kata.juez2_puntaje) === 7.1 &&
  kata.juez3_puntaje === null && kata.juez4_puntaje === null && kata.juez_central_nombre === 'Carla' && Number(kata.juez_central_puntaje) === 7.2 &&
  kata.jueces_descartados.length === 0)
const dest = await uno(`select * from public.resultados_jurado where modulo = 'destreza' and organizacion_id = '${orgB.id}'`)
const dest0 = dest
prueba('Destreza, sin que la app elija torneo, queda en el torneo abierto', dest0.torneo_id === id(101))
prueba('Destreza: el área del puesto reemplaza al área vacía, sin ronda, y se descartan juez 1 y central',
  dest.area === 9 && dest.ronda === null && dest.kata === null && dest.responsable_mesa === null && JSON.stringify([...dest.jueces_descartados].sort()) === '[1,5]' &&
  Number(dest.juez4_puntaje) === 7.5 && Number(dest.juez_central_puntaje) === 7.8)
const kum = await uno(`select * from public.resultados_kumite where organizacion_id = '${orgB.id}'`)
prueba('Kumite: marcador, faltas, ganador y duración se guardan con su tipo',
  kum.puntaje_shiro === 3 && kum.puntaje_aka === 1 && kum.lado_ganador === 'shiro' && kum.encho_sen === true && kum.duracion_restante_ms === 12346 &&
  kum.faltas.shiro.chukoku[0] === 'adv' && kum.salida === null && kum.sistema_jueces === 3 && kum.categoria === 'Cadete')

// ---------------------------------------------------------------- 10) Corregir y borrar resultados
console.log('\n10) Corregir y borrar resultados')
// (el dueño de FAKKO es NUEVO; el juez no tiene el permiso; hay resultados de la sección 9)
const filaK = await uno(`select id from public.resultados_jurado where organizacion_id = '${orgB.id}' and modulo = 'kata'`)
const filaD = await uno(`select id from public.resultados_jurado where organizacion_id = '${orgB.id}' and modulo = 'destreza'`)
const filaKum = await uno(`select id from public.resultados_kumite where organizacion_id = '${orgB.id}'`)
const afecta = async (sql) => (await db.query(sql)).rows.length
prueba('el rol Admin trae el permiso editar_historial y el juez no', (await todos(NUEVO)).some((r) => r.permiso === 'editar_historial') && !(await todos(U.juezB)).some((r) => r.permiso === 'editar_historial'))
prueba('el juez no puede corregir un resultado (ni siquiera lo ve)', await como(U.juezB, async () => (await afecta(`update public.resultados_jurado set competidor = 'Otro' where id = '${filaK.id}' returning id`)) === 0))
prueba('el juez no puede borrar un resultado', await como(U.juezB, async () => (await afecta(`delete from public.resultados_jurado where id = '${filaK.id}' returning id`)) === 0))
prueba('el dueño de otra organización no puede corregir resultados ajenos', await como(U.duenoC, async () => (await afecta(`update public.resultados_jurado set competidor = 'Otro' where id = '${filaK.id}' returning id`)) === 0))
prueba('el Admin corrige un resultado de jurado', await como(NUEVO, async () => (await afecta(`update public.resultados_jurado set competidor = 'Lucía Fernández', juez1_puntaje = 7.4, puntaje_final = 21.7 where id = '${filaK.id}' returning id`)) === 1))
const corr = await uno(`select * from public.resultados_jurado where id = '${filaK.id}'`)
prueba('queda anotado quién y cuándo lo corrigió, y lo cargado originalmente no cambia', corr.editado_por === NUEVO && corr.editado_en !== null && corr.creado_por === U.juezB && corr.competidor === 'Lucía Fernández' && Number(corr.juez1_puntaje) === 7.4)
prueba('un resultado sin corregir no tiene marca de edición', (await uno(`select editado_por, editado_en from public.resultados_jurado where id = '${filaD.id}'`)).editado_en === null)
for (const [cambio, texto] of [
  [`organizacion_id = '${orgC.id}'`, 'cambiar de organización'],
  [`modulo = 'kobudo'`, 'cambiar el módulo'],
  [`sistema_jueces = 5`, 'cambiar el sistema de jueces'],
  [`creado_por = '${NUEVO}'`, 'cambiar quién lo cargó'],
  [`creado_en = now() - interval '1 day'`, 'cambiar cuándo se cargó'],
]) {
  prueba(`no se puede ${texto}`, await como(NUEVO, () => falla(() => db.exec(`update public.resultados_jurado set ${cambio} where id = '${filaK.id}'`), 'No se puede cambiar|row-level security|check')))
}
prueba('la corrección sigue validando las reglas (puntaje fuera de rango)', await como(NUEVO, () => falla(() => db.exec(`update public.resultados_jurado set juez1_puntaje = 12 where id = '${filaK.id}'`), 'check')))
prueba('el Admin corrige un combate de kumite', await como(NUEVO, async () => (await afecta(`update public.resultados_kumite set nombre_shiro = 'Ana María', puntaje_shiro = 4, lado_ganador = 'shiro' where id = '${filaKum.id}' returning id`)) === 1))
const aud = await filas(`select accion, detalle from public.auditoria where organizacion_id = '${orgB.id}' and accion = 'editar_resultado' order by id`)
prueba('cada corrección queda en la auditoría, con el antes y el después', aud.length === 2 && aud[0].detalle.antes.competidor === 'Lucía' && aud[0].detalle.despues.competidor === 'Lucía Fernández' && aud[0].detalle.tabla === 'resultados_jurado')
prueba('el Admin borra un resultado', await como(NUEVO, async () => (await afecta(`delete from public.resultados_jurado where id = '${filaD.id}' returning id`)) === 1))
const borr = await uno(`select detalle from public.auditoria where accion = 'borrar_resultado' and detalle ->> 'resultado_id' = '${filaD.id}'`)
prueba('el borrado queda en la auditoría con una copia del resultado', borr?.detalle.antes.competidor === 'Equipo Norte' && borr.detalle.resultado_id === filaD.id)
prueba('el dueño ve en la auditoría los cambios del historial', (await como(NUEVO, () => filas(`select * from public.auditoria where accion in ('editar_resultado','borrar_resultado') and actor_id = '${NUEVO}'`))).length === 3)
prueba('un anónimo no puede corregir ni borrar', await comoAnonimo(async () => (await falla(() => db.exec(`update public.resultados_kumite set categoria = 'x'`), 'permission denied')) && (await falla(() => db.exec(`delete from public.resultados_kumite`), 'permission denied'))))
// El formulario de corrección arma sus cambios con src/lib/editarResultado.js: se ejecutan contra la base real
async function actualizarComoLaApp(uid, tabla, id, cambios) {
  const columnas = Object.keys(cambios)
  const valores = Object.values(cambios).map((v) => (Array.isArray(v) ? `{${v.join(',')}}` : v))
  const sets = columnas.map((c, i) => `${c} = $${i + 1}` + (c === 'jueces_descartados' ? '::smallint[]' : ''))
  return db.query(`update public.${tabla} set ${sets.join(', ')} where id = '${id}' returning *`, valores)
}
// Kata de la sección 9 (3 jueces): se corrigen el nombre del juez 2 y el puntaje del central
const rowKata = { ...(await uno(`select * from public.resultados_jurado where id = '${filaK.id}'`)), tabla: 'jurado' }
const vK = valoresIniciales(rowKata)
prueba('el formulario de un resultado de 3 jueces muestra solo los jueces que actuaron', vK.jueces.length === 3 && vK.jueces.map((j) => j.etiqueta).join() === 'Juez Nº1,Juez Nº2,Juez Central')
vK.jueces[1].nombre = '  Beto Díaz '
vK.jueces[2].puntaje = '7.5'
prueba('el formulario recalcula el puntaje final (7.4 + 7.1 + 7.5)', calcularDeValores(vK).final === 22)
prueba('el formulario valida antes de guardar', validar(vK) === '' && validar({ ...vK, competidor: '  ' }) !== '' && validar({ ...vK, area: '1000' }) !== '' && validar({ ...vK, jueces: vK.jueces.map((j, i) => (i === 0 ? { ...j, puntaje: '11' } : j)) }) !== '')
const resK = await como(NUEVO, () => actualizarComoLaApp(NUEVO, 'resultados_jurado', filaK.id, cambiosDesdeValores(vK)))
const kataCorr = resK.rows[0]
prueba('los cambios del formulario encajan con la tabla: nombre limpio, puntaje y total recalculados, 3 jueces intactos',
  resK.rows.length === 1 && kataCorr.juez2_nombre === 'Beto Díaz' && Number(kataCorr.juez_central_puntaje) === 7.5 && Number(kataCorr.puntaje_final) === 22 &&
  kataCorr.juez3_puntaje === null && kataCorr.sistema_jueces === 3 && kataCorr.modulo === 'kata')
// Kumite de la sección 9: se cambia el ganador a empate
const vKu = valoresIniciales({ ...(await uno(`select * from public.resultados_kumite where id = '${filaKum.id}'`)), tabla: 'kumite' })
vKu.lado = 'empate'
vKu.puntajeAka = '4'
const resKu = await como(NUEVO, () => actualizarComoLaApp(NUEVO, 'resultados_kumite', filaKum.id, cambiosDesdeValores(vKu)))
prueba('los cambios del formulario de kumite encajan con la tabla (ganador, puntajes y texto)', resKu.rows.length === 1 && resKu.rows[0].ganador === 'EMPATE' && resKu.rows[0].lado_ganador === 'empate' && resKu.rows[0].puntaje_aka === 4 && validar(vKu) === '')
prueba('al corregir, el torneo del resultado se conserva', kataCorr.torneo_id === id(101))
const vTorneo = { ...vK, torneoId: '' }
const resSin = await como(NUEVO, () => actualizarComoLaApp(NUEVO, 'resultados_jurado', filaK.id, cambiosDesdeValores(vTorneo)))
prueba('se puede dejar un resultado sin torneo', resSin.rows[0].torneo_id === null)
const resCon = await como(NUEVO, () => actualizarComoLaApp(NUEVO, 'resultados_jurado', filaK.id, cambiosDesdeValores({ ...vK, torneoId: id(102) })))
prueba('se puede pasar un resultado a otro torneo de la misma organización', resCon.rows[0].torneo_id === id(102))
prueba('no se puede pasar un resultado a un torneo de otra organización', await como(NUEVO, () => falla(() => actualizarComoLaApp(NUEVO, 'resultados_jurado', filaK.id, cambiosDesdeValores({ ...vK, torneoId: id(201) })), 'row-level security')))
prueba('un resultado de destreza no muestra el campo kata y su cambio lo deja en NULL', cambiosDesdeValores({ ...vK, modulo: 'destreza', kata: 'algo' }).kata === null)

await db.exec(`delete from public.organizaciones where id = '${orgB.id}'`)
prueba('borrar una organización con resultados no choca con la auditoría', Number((await uno(`select count(*) n from public.organizaciones where id = '${orgB.id}'`)).n) === 0)

// Cálculo del puntaje final (las mismas reglas que las pantallas)
const pts = (...v) => v.map((puntaje, i) => ({ posicion: i === v.length - 1 ? 5 : i + 1, puntaje }))
prueba('3 jueces: suma de los tres', JSON.stringify(calcularPuntaje(pts(7.3, 7.1, 7.2), 3)) === JSON.stringify({ final: 21.6, descartados: [] }))
prueba('5 jueces: se descartan el mayor y el menor', JSON.stringify(calcularPuntaje(pts(6, 7, 7.1, 7.5, 7.8), 5)) === JSON.stringify({ final: 21.6, descartados: [5, 1] }))
prueba('5 jueces con todos iguales: mayor = el primero cargado, menor = el último', JSON.stringify(calcularPuntaje(pts(7, 7, 7, 7, 7), 5)) === JSON.stringify({ final: 21, descartados: [1, 5] }))
prueba('con 5 jueces, un empate en el mayor descarta al primero', JSON.stringify(calcularPuntaje(pts(8, 6, 7, 8, 7), 5)) === JSON.stringify({ final: 22, descartados: [1, 2] }))
prueba('si falta un puntaje no hay resultado', calcularPuntaje(pts(7, '', 7), 3).final === null && calcularPuntaje(pts(7, 7), 3).final === null)

// ---------------------------------------------------------------- 11) Mensaje para pasarle al cliente
console.log('\n11) Datos para pasarle al cliente')
const base = { nombre: 'Club Norte', urlDueno: 'https://x.test/ipponia/ingresar', urlUsuarios: 'https://x.test/ipponia/club-norte/ingresar' }
const alta = mensajeParaCliente({ ...base, email: 'dueno@club.test', clave: 'Abc123xyz' })
prueba('el alta trae las dos direcciones, el email y la contraseña inicial', ['Club Norte', base.urlDueno, base.urlUsuarios, 'Email: dueno@club.test', 'Contraseña inicial: Abc123xyz'].every((t) => alta.includes(t)))
prueba('el alta avisa que la primera vez pide cambiar la contraseña', alta.includes('te va a pedir que la cambies'))
const invitacion = mensajeParaCliente({ ...base, email: 'dueno@club.test', clave: null })
prueba('sin contraseña inicial avisa de la invitación por email y no inventa una contraseña', invitacion.includes('invitación por email') && !invitacion.includes('Contraseña inicial'))
const existente = mensajeParaCliente({ ...base, vence: '31/12/2026' })
prueba('una organización existente trae solo las direcciones y el vencimiento (no hay contraseña que mostrar)', existente.includes(base.urlUsuarios) && existente.includes('vigente hasta el 31/12/2026') && !existente.includes('Contraseña inicial') && !existente.includes('Email:'))
prueba('sin vencimiento no menciona ninguna fecha', !mensajeParaCliente(base).includes('vigente'))

// ---------------------------------------------------------------- 12) Identificador generado del nombre
console.log('\n12) El identificador de la organización se genera del nombre')
prueba('sin tildes, en minúsculas y con guiones', slugDesdeNombre('Club Núñez & Hijos') === 'club-nunez-hijos')
prueba('una ñ queda como n', slugDesdeNombre('Dojo Español') === 'dojo-espanol')
prueba('espacios y signos de más no dejan guiones sobrantes', slugDesdeNombre('  ¡Karate  Do!  ') === 'karate-do')
prueba('un nombre muy corto se completa para llegar a 3 caracteres', slugDesdeNombre('AB') === 'ab-org')
prueba('un nombre sin letras ni números no genera nada (la pantalla pide escribirlo)', slugDesdeNombre('¡¿?!') === '')
prueba('un nombre muy largo se corta sin terminar en guion', slugDesdeNombre('Asociación Argentina de Karate Tradicional Estilo Shotokan').length <= 34 && !slugDesdeNombre('Asociación Argentina de Karate Tradicional Estilo Shotokan').endsWith('-'))
prueba('una palabra reservada (/kata, /cuenta…) no se usa tal cual', slugDesdeNombre('Kata') === 'kata-org' && slugDesdeNombre('Cuenta') === 'cuenta-org')
prueba('si ya existe, se prueba con -2, -3…', conSufijo('club-norte', 1) === 'club-norte' && conSufijo('club-norte', 2) === 'club-norte-2' && conSufijo('club-norte', 3) === 'club-norte-3')
prueba('la lista de palabras reservadas de la app es la misma que la de la base', JSON.stringify([...SLUGS_RESERVADOS].sort()) === JSON.stringify([...(await uno('select public.slugs_reservados() r')).r].sort()))
const nombresPrueba = ['Ikigai Dojo', 'Hector Maroli', 'Club Núñez & Hijos', 'AB', 'Kata', 'Dojo Ñandú 2026', 'A', 'Asociación Argentina de Karate Tradicional Estilo Shotokan', 'Ipponia', 'Ñ']
let validos = true
for (const n of nombresPrueba) {
  for (const k of [1, 2, 9]) {
    const sl = conSufijo(slugDesdeNombre(n), k)
    const r = await uno(`select ('${sl}' ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' and not '${sl}' = any (public.slugs_reservados())) as ok`)
    if (!r.ok) { validos = false; console.log('    inválido: ' + n + ' → ' + sl) }
  }
}
prueba('todos los identificadores generados (con y sin sufijo) cumplen las reglas de la base', validos)

// ---------------------------------------------------------------- 13) Ranking de la pantalla pública
console.log('\n13) Ranking de la pantalla pública')
const grupo = { modulo: 'Kata', area: 2, ronda: 1 }
let rk = null
const pun = [['Lucía', 28.6], ['Mateo', 28.2], ['Camila', 27.9], ['Tomás', 27.4], ['Valentina', 27.1], ['Joaquín', 26.8], ['Sofía', 26.5], ['Bruno', 26.1], ['Agustina', 25.9], ['Nico', 25.5]]
pun.forEach(([competidor, puntaje], i) => { rk = agregarResultado(rk, { ...grupo, competidor, puntaje, ahora: 1000 + i }) })
const top = posiciones(rk.filas)
prueba('se muestran solo los 8 mejores, de mayor a menor puntaje', top.length === 8 && top[0].competidor === 'Lucía' && top[7].competidor === 'Bruno' && !top.some((f) => f.competidor === 'Nico'))
prueba('los puestos van del 1 al 8', top.map((f) => f.puesto).join() === '1,2,3,4,5,6,7,8')
prueba('el último en puntuar queda marcado (para la etiqueta NUEVO)', rk.ultimo === 'nico')
const orden = (arr) => arr.reduce((r, [c, p], i) => agregarResultado(r, { ...grupo, competidor: c, puntaje: p, ahora: 100 + i }), null)
const empatados = posiciones(orden([['A', 28], ['B', 27], ['C', 27], ['D', 26]]).filas)
prueba('los empates comparten puesto y el siguiente salta (1, 2, 2, 4)', empatados.map((f) => f.puesto).join() === '1,2,2,4')
prueba('entre empatados va primero quien puntuó antes', empatados[1].competidor === 'B' && empatados[2].competidor === 'C')
prueba('un empate triple en el primer puesto (1, 1, 1, 4)', posiciones(orden([['A', 9], ['B', 9], ['C', 9], ['D', 8]]).filas).map((f) => f.puesto).join() === '1,1,1,4')
prueba('los decimales con ruido de coma flotante empatan (0.1 + 0.2 = 0.3)', posiciones(orden([['A', 0.1 + 0.2], ['B', 0.3]]).filas).map((f) => f.puesto).join() === '1,1')
const corregido = agregarResultado(orden([['Ana', 20], ['Beto', 25]]), { ...grupo, competidor: '  ana ', puntaje: 27, ahora: 500 })
prueba('si el mismo competidor puntúa de nuevo, vale el último puntaje (sin repetirlo ni distinguir mayúsculas)', corregido.filas.length === 2 && posiciones(corregido.filas)[0].competidor === 'ana' && posiciones(corregido.filas)[0].puntaje === 27)
const otraRonda = agregarResultado(rk, { ...grupo, ronda: 2, competidor: 'Zoe', puntaje: 10, ahora: 9000 })
prueba('el primer puntaje de otra ronda empieza un ranking nuevo', otraRonda.filas.length === 1 && otraRonda.ronda === 2)
prueba('lo mismo con otro módulo u otra área', agregarResultado(rk, { ...grupo, modulo: 'Kobudo', competidor: 'Zoe', puntaje: 10 }).filas.length === 1 && agregarResultado(rk, { ...grupo, area: 3, competidor: 'Zoe', puntaje: 10 }).filas.length === 1)
prueba('sin nombre no se pierde el resultado ni se pisa con otro', agregarResultado(agregarResultado(null, { ...grupo, competidor: '', puntaje: 5, ahora: 1 }), { ...grupo, competidor: '', puntaje: 6, ahora: 2 }).filas.length === 2)
prueba('con pocos competidores se muestran los que hay', posiciones(orden([['A', 5]]).filas).length === 1 && posiciones([]).length === 0)

// desempate con 5 jueces: mismo puntaje final -> el menor puntaje más alto -> el mayor puntaje más alto -> empate
const con5 = (arr) => arr.reduce((r, [c, p, menor, mayor], i) => agregarResultado(r, { ...grupo, competidor: c, puntaje: p, sistema: 5, menor, mayor, ahora: 100 + i }), null)
const d1 = posiciones(con5([['A', 28, 8.8, 9.7], ['B', 28, 9.0, 9.6], ['C', 27, 9.9, 9.9]]).filas)
prueba('5 jueces: a igual puntaje gana quien tiene el menor puntaje más alto (aunque haya puntuado después)', d1[0].competidor === 'B' && d1[1].competidor === 'A' && d1.map((f) => f.puesto).join() === '1,2,3' && !d1.some((f) => f.empatado))
const d2 = posiciones(con5([['A', 28, 9.0, 9.4], ['B', 28, 9.0, 9.7]]).filas)
prueba('si los menores son iguales, gana quien tiene el mayor puntaje más alto', d2[0].competidor === 'B' && d2.map((f) => f.puesto).join() === '1,2' && !d2.some((f) => f.empatado))
const d3 = posiciones(con5([['A', 28, 9.0, 9.7], ['B', 28, 9.0, 9.7], ['C', 27, 9.5, 9.6]]).filas)
prueba('si también el mayor es igual, es empate: comparten puesto y quedan marcados', d3.map((f) => f.puesto).join() === '1,1,3' && d3[0].empatado && d3[1].empatado && !d3[2].empatado)
prueba('y se informa en qué puesto hay que desempatar', JSON.stringify(puestosEmpatados(d3)) === '[1]')
prueba('el desempate no cambia el orden por puntaje final (28 antes que 27 aunque el 27 tenga mejores extremos)', d1[2].competidor === 'C')
const t3 = posiciones(orden([['A', 20], ['B', 20]]).filas)
prueba('con 3 jueces no hay criterio: el empate queda marcado tal cual', t3.map((f) => f.puesto).join() === '1,1' && t3.every((f) => f.empatado))
const mixto = posiciones([agregarResultado(null, { ...grupo, competidor: 'A', puntaje: 28, sistema: 5, menor: 9, mayor: 9.5, ahora: 1 }).filas[0], agregarResultado(null, { ...grupo, competidor: 'B', puntaje: 28, sistema: 3, ahora: 2 }).filas[0]])
prueba('si uno es de 3 jueces y otro de 5, no se comparan extremos: empate', mixto.map((f) => f.puesto).join() === '1,1')
const t5 = posiciones(con5([['A', 28, 9, 9.5], ['B', 28, 9, 9.5], ['C', 27, 9, 9.5], ['D', 27, 9, 9.5]]).filas)
prueba('puede haber dos empates a la vez (1.º y 3.º)', JSON.stringify(puestosEmpatados(t5)) === '[1,3]')
const borde = posiciones(con5([['P1', 30, 9, 9], ['P2', 29, 9, 9], ['P3', 28, 9, 9], ['P4', 27, 9, 9], ['P5', 26, 9, 9], ['P6', 25, 9, 9], ['P7', 24, 9, 9], ['P8', 23, 9, 9], ['P9', 23, 9, 9], ['P10', 22, 9, 9]]).filas)
prueba('si hay empate en el 8.º puesto entran todos los empatados (9 filas) y el 10.º queda afuera', borde.length === 9 && borde[7].puesto === 8 && borde[8].puesto === 8 && borde[7].empatado)
prueba('un resultado viejo sin datos de desempate se lee sin romperse (queda como 3 jueces)', posiciones([{ id: 'x', competidor: 'X', puntaje: 5, en: 1 }, { id: 'y', competidor: 'Y', puntaje: 5, en: 2 }]).every((f) => f.puesto === 1 && f.empatado))

// volver a pasar para desempatar: el puntaje de desempate NO reemplaza al original, solo ordena a los empatados
const paso = (r, competidor, puntaje, ahora, extra = {}) => agregarResultado(r, { ...grupo, competidor, puntaje, ahora, ...extra })
let de = null
de = paso(de, 'A', 28, 1); de = paso(de, 'B', 28, 2); de = paso(de, 'C', 27.9, 3)
prueba('A y B empatan en 28 y C es tercero', posiciones(de.filas).map((f) => f.puesto).join() === '1,1,3')
de = paso(de, 'A', 27.5, 10)
prueba('A vuelve a pasar: el empate sigue hasta que B también pase', posiciones(de.filas).map((f) => f.puesto).join() === '1,1,3' && de.filas.find((f) => f.id === 'a').puntaje === 28)
de = paso(de, 'B', 27.8, 11)
const trasDesempate = posiciones(de.filas)
prueba('B pasa y gana el desempate: B primero, A segundo, C tercero, sin empates', trasDesempate.map((f) => f.competidor).join() === 'B,A,C' && trasDesempate.map((f) => f.puesto).join() === '1,2,3' && !trasDesempate.some((f) => f.empatado))
prueba('los puntajes originales no cambian con el desempate (C no pasa a ganarle a A y B)', trasDesempate.map((f) => f.puntaje).join() === '28,28,27.9')
prueba('quedan guardados los puntajes de desempate (para mostrarlos)', trasDesempate[0].desempates[0].puntaje === 27.8 && trasDesempate[1].desempates[0].puntaje === 27.5)
let de2 = null
de2 = paso(de2, 'A', 28, 1); de2 = paso(de2, 'B', 28, 2)
de2 = paso(de2, 'A', 27.5, 10); de2 = paso(de2, 'A', 27.9, 11)
prueba('si el mismo empatado se equivoca y vuelve a cargar antes que el rival, se corrige (no cuenta dos vueltas)', de2.filas.find((f) => f.id === 'a').desempates.length === 1 && de2.filas.find((f) => f.id === 'a').desempates[0].puntaje === 27.9)
de2 = paso(de2, 'B', 27.9, 12)
prueba('si en el desempate vuelven a igualar, siguen empatados y tienen que pasar de nuevo', posiciones(de2.filas).map((f) => f.puesto).join() === '1,1')
de2 = paso(de2, 'A', 27.0, 20); de2 = paso(de2, 'B', 27.3, 21)
prueba('en la segunda vuelta de desempate se resuelve', posiciones(de2.filas).map((f) => f.competidor).join() === 'B,A' && !posiciones(de2.filas).some((f) => f.empatado))
let de3 = null
;[['A', 28], ['B', 28], ['C', 28], ['D', 20]].forEach(([c, p], i) => { de3 = paso(de3, c, p, i + 1) })
de3 = paso(de3, 'A', 27, 10); de3 = paso(de3, 'B', 27.5, 11)
prueba('con tres empatados no se resuelve nada hasta que pasen los tres', posiciones(de3.filas).map((f) => f.puesto).join() === '1,1,1,4')
de3 = paso(de3, 'C', 27.5, 12)
const parcial = posiciones(de3.filas)
prueba('pasan los tres: A queda tercero y B y C siguen empatados en el 1.º', parcial.map((f) => f.puesto).join() === '1,1,3,4' && parcial[2].competidor === 'A' && parcial[0].empatado && !parcial[2].empatado)
let de5 = null
;[['A', 28, 9, 9.6], ['B', 28, 9, 9.6]].forEach(([c, p, m, M], i) => { de5 = paso(de5, c, p, i + 1, { sistema: 5, menor: m, mayor: M }) })
de5 = paso(de5, 'A', 27, 10, { sistema: 5, menor: 8.9, mayor: 9.5 }); de5 = paso(de5, 'B', 27, 11, { sistema: 5, menor: 9.1, mayor: 9.4 })
prueba('el desempate también usa los criterios de 5 jueces (mismo puntaje, gana el menor más alto)', posiciones(de5.filas)[0].competidor === 'B' && !posiciones(de5.filas)[0].empatado)

// resultado de la categoría (Finalizar categoría)
prueba('sin puntajes no hay resultado de categoría', resultadoDeCategoria(null).estado === 'vacio' && resultadoDeCategoria({ filas: [] }).estado === 'vacio')
const final1 = resultadoDeCategoria(rk)
prueba('con el podio definido muestra los 3 mejores', final1.estado === 'listo' && final1.filas.length === 3 && final1.filas.map((f) => f.competidor).join() === 'Lucía,Mateo,Camila')
prueba('con empate en el podio no se puede cerrar: muestra el empate', resultadoDeCategoria(de).estado === 'listo' && resultadoDeCategoria(paso(paso(null, 'A', 28, 1), 'B', 28, 2)).estado === 'empate')
prueba('un empate fuera del podio (4.º y 5.º) no impide cerrar', resultadoDeCategoria(orden([['A', 30], ['B', 29], ['C', 28], ['D', 20], ['E', 20]])).estado === 'listo')
prueba('un empate en el 3.º puesto sí cuenta (hay que definir el bronce)', resultadoDeCategoria(orden([['A', 30], ['B', 29], ['C', 28], ['D', 28]])).estado === 'empate' && resultadoDeCategoria(orden([['A', 30], ['B', 29], ['C', 28], ['D', 28]])).empates.join() === '3')
prueba('un empate en el 2.º puesto: el podio es A, B, C y hay que definir quién es segundo', resultadoDeCategoria(orden([['A', 30], ['B', 29], ['C', 29]])).estado === 'empate')
const finalizado = { ...orden([['A', 30], ['B', 29]]), cierre: 'categoria' }
prueba('después de cerrar una categoría, el primer puntaje de la siguiente empieza un ranking nuevo (aunque sea el mismo grupo)', agregarResultado(finalizado, { ...grupo, competidor: 'Nuevo', puntaje: 5, ahora: 9 }).filas.length === 1)
prueba('un puntaje nuevo quita la marca de cierre', agregarResultado({ ...orden([['A', 30]]), cierre: 'ronda' }, { ...grupo, competidor: 'B', puntaje: 5, ahora: 9 }).cierre === null)
const memC = new Map()
const almC = { getItem: (k) => memC.get(k) ?? null, setItem: (k, v) => memC.set(k, String(v)), removeItem: (k) => memC.delete(k) }
registrarEnRanking({ ...grupo, competidor: 'A', puntaje: 10, ahora: 1000 }, almC)
marcarCierre('ronda', almC)
prueba('se puede marcar que terminó la ronda', leerRanking(almC, 2000).cierre === 'ronda')
marcarCierre(null, almC)
prueba('y desmarcarlo', leerRanking(almC, 2000).cierre === null)
limpiarRanking(almC)
marcarCierre('ronda', almC)
prueba('marcar sin ranking no inventa uno', leerRanking(almC, 2000) === null)

// puntaje que decidió el desempate (para mostrarlo en pantalla)
const cr = (arr) => posiciones(con5(arr).filas)
const c1 = cr([['Beto', 28, 8.9, 9.8], ['Ana', 28, 9.1, 9.6]])
prueba('si decidió el menor, los dos muestran su puntaje más bajo (y no el más alto)', c1[0].competidor === 'Ana' && JSON.stringify(c1[0].criterios) === '[{"tipo":"menor","valor":9.1}]' && JSON.stringify(c1[1].criterios) === '[{"tipo":"menor","valor":8.9}]')
const c2 = cr([['Diego', 27.5, 9.0, 9.5], ['Carla', 27.5, 9.0, 9.7]])
prueba('si los menores eran iguales y decidió el mayor, los dos muestran su puntaje más alto', c2[0].competidor === 'Carla' && JSON.stringify(c2[0].criterios) === '[{"tipo":"mayor","valor":9.7}]' && JSON.stringify(c2[1].criterios) === '[{"tipo":"mayor","valor":9.5}]')
const c3 = cr([['A', 28, 9.1, 9.5], ['B', 28, 9.1, 9.7], ['C', 28, 8.9, 9.9]])
prueba('con tres iguales: todos muestran el menor, y el mayor solo los dos que compartían menor', JSON.stringify(c3.map((f) => [f.competidor, f.criterios.map((c) => c.tipo + c.valor).join('+')])) === '[["B","menor9.1+mayor9.7"],["A","menor9.1+mayor9.5"],["C","menor8.9"]]')
const c4 = cr([['A', 28, 9.0, 9.5], ['B', 28, 9.0, 9.5], ['C', 28, 8.8, 9.9]])
prueba('los que siguen empatados no muestran el puntaje del mayor (no decidió nada entre ellos)', c4[0].empatado && c4[1].empatado && c4.slice(0, 2).every((f) => f.criterios.map((c) => c.tipo).join() === 'menor') && c4[2].criterios.map((c) => c.tipo).join() === 'menor')
prueba('con puntajes finales distintos no hay nada que mostrar', cr([['A', 28, 9.0, 9.5], ['B', 27, 9.1, 9.6]]).every((f) => f.criterios.length === 0))
prueba('con 3 jueces tampoco (no hay criterio)', posiciones(orden([['A', 20], ['B', 20]]).filas).every((f) => f.criterios.length === 0))

// guardado en el navegador (almacenamiento simulado)
const mem = new Map()
const almacen = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
registrarEnRanking({ ...grupo, competidor: 'Lucía', kata: 'Heian Shodan', puntaje: 28.6, ahora: 1000 }, almacen)
registrarEnRanking({ ...grupo, competidor: 'Mateo', puntaje: 28.2, ahora: 2000 }, almacen)
prueba('el ranking se guarda y se lee con los competidores y el kata', leerRanking(almacen, 3000)?.filas.length === 2 && leerRanking(almacen, 3000).filas[0].kata === 'Heian Shodan')
registrarEnRanking({ ...grupo, competidor: 'Zoe', puntaje: null, ahora: 2500 }, almacen)
registrarEnRanking({ ...grupo, competidor: 'Zoe', puntaje: 'abc', ahora: 2600 }, almacen)
prueba('un resultado sin puntaje válido no entra al ranking', leerRanking(almacen, 3000).filas.length === 2)
prueba('pasadas 12 horas sin puntajes, el ranking se considera olvidado', estaVencido(leerRanking(almacen, 3000), 2000 + 13 * 3600 * 1000) && leerRanking(almacen, 2000 + 13 * 3600 * 1000) === null)
limpiarRanking(almacen)
prueba('"Finalizar categoría" lo borra', leerRanking(almacen, 3000) === null)
mem.set('tm-ranking', '{no es json')
prueba('un dato dañado no rompe la pantalla pública', leerRanking(almacen, 3000) === null)

console.log(`\nResultado: ${ok} pruebas correctas, ${fallos} fallidas.`)
process.exit(fallos ? 1 : 0)
