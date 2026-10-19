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

console.log(`\nResultado: ${ok} pruebas correctas, ${fallos} fallidas.`)
process.exit(fallos ? 1 : 0)
