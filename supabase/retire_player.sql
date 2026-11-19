-- ATTACK F.C. 선수 탈퇴(퇴단) 처리
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run. 여러 번 실행해도 안전해요.
-- 경기 기록·이름·등번호는 팀 기록으로 남기고, 개인정보(사진·생일·지역·별명)와 카카오 연결 계정은 삭제합니다.

-- 1) players.status 에 'left'(탈퇴) 값 허용 -----------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    join pg_class t on t.oid = con.conrelid and t.relname = 'players'
    join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
    where con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.players drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.players add constraint players_status_check
  check (status is null or status in ('active','injured','resting','left'));

-- 2) 관리자: 선수 탈퇴 / 되돌리기 -------------------------------------------
create or replace function public.admin_retire_player(p_player bigint, p_retire boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception '관리자만 할 수 있어요'; end if;
  if not exists (select 1 from public.players where id = p_player) then raise exception '선수를 찾을 수 없어요'; end if;
  if p_retire then
    update public.players
       set status = 'left', photo_url = null, birth_date = null, region = null, nickname = null
     where id = p_player;
    -- 연결된 카카오 계정 삭제 (members 행은 cascade 로 함께 삭제)
    delete from auth.users where id in (select user_id from public.members where player_id = p_player and user_id <> auth.uid());
  else
    update public.players set status = 'active' where id = p_player;
  end if;
end $$;
revoke all on function public.admin_retire_player(bigint, boolean) from public, anon;
grant execute on function public.admin_retire_player(bigint, boolean) to authenticated;

-- 3) 회원가입 때 탈퇴 선수는 고를 수 없게 ------------------------------------
create or replace function public.claimable_players()
returns table (id bigint, name text, number int, birth_missing boolean)
language sql stable security definer set search_path = public as $$
  select p.id::bigint, p.name, p.number::int, (p.birth_date is null)
  from public.players p
  where auth.uid() is not null
    and coalesce(p.status, 'active') <> 'left'
    and not exists (select 1 from public.members m where m.player_id = p.id)
  order by p.name
$$;
