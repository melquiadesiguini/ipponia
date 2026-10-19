-- =====================================================================
-- IPPONIA · Resultados cargados sin conexión
-- =====================================================================
-- Cuando no hay internet, la aplicación guarda el resultado en el dispositivo y lo envía cuando vuelve la
-- conexión. Para que ese resultado quede como si se hubiera cargado en el momento, el envío trae:
--   * creado_en : la hora real en que se cargó (no la del envío)
--   * torneo_id : el torneo que estaba abierto en ese momento (puede haberse cerrado mientras tanto)
--
-- Reglas (en la base, no en la pantalla):
--   * Un resultado con hora de más de 5 minutos en el futuro (reloj mal puesto) se guarda con la hora del servidor.
--   * Un resultado de más de 14 días atrás se rechaza: es demasiado viejo para llegar "tarde".
--   * El torneo que mande la aplicación solo se respeta si el resultado llega tarde (más de 2 minutos después de su hora),
--     el torneo es de la misma organización y está abierto o cerrado (no en borrador). En cualquier otro caso se
--     sigue ignorando: el resultado va al torneo abierto, y si no hay ninguno, se rechaza (migración 20261015150000).
--   * Los resultados se pueden repetir sin duplicarse: la aplicación manda el mismo id, y la clave primaria lo impide.
-- Requiere: 20261015150000_torneo_abierto.sql

create or replace function public.asignar_torneo_abierto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  abierto uuid;
  elegido uuid;
  llega_tarde boolean;
begin
  if new.creado_en > now() + interval '5 minutes' then
    new.creado_en := now();
  end if;
  if new.creado_en < now() - interval '14 days' then
    raise exception 'El resultado tiene más de 14 días: es demasiado viejo para enviarse. Cargalo de nuevo o pedile ayuda al administrador.';
  end if;

  llega_tarde := new.creado_en < now() - interval '2 minutes';
  select id into abierto from public.torneos where organizacion_id = new.organizacion_id and estado = 'activo';

  if llega_tarde and new.torneo_id is not null then
    select id into elegido
    from public.torneos
    where id = new.torneo_id and organizacion_id = new.organizacion_id and estado in ('activo', 'finalizado');
  end if;

  new.torneo_id := coalesce(elegido, abierto);
  if new.torneo_id is null then
    raise exception 'No hay un torneo abierto. Abrí uno en Configuración → Torneos para poder cargar resultados.';
  end if;
  return new;
end;
$$;

revoke execute on function public.asignar_torneo_abierto() from public, anon, authenticated;
