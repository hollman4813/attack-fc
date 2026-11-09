-- ATTACK F.C. 회원(카카오 로그인) 1단계
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run.
-- 여러 번 실행해도 안전하게 작성했습니다. (기존 테이블 접근 규칙은 바꾸지 않습니다)

-- 1) 회원 테이블 ---------------------------------------------------------
create table if not exists public.members (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  kakao_nickname  text,
  player_id       bigint,
  requested_birth date,
  role            text not null default 'pending'
                  check (role in ('pending','member','staff','admin')),
  requested_at    timestamptz,
  approved_at     timestamptz,
  created_at      timestamptz not null default now()
);
-- 한 선수는 한 계정에만 연결
create unique index if not exists members_player_uniq
  on public.members(player_id) where player_id is not null;

alter table public.members enable row level security;

-- 2) 내 권한 조회 함수 -----------------------------------------------------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid()
$$;
revoke all on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;

-- 3) 읽기 규칙: 본인 행 + 관리자는 전체. 쓰기는 아래 함수로만 가능 -------------
drop policy if exists members_select_own   on public.members;
drop policy if exists members_select_admin on public.members;
create policy members_select_own   on public.members for select to authenticated
  using (user_id = auth.uid());
create policy members_select_admin on public.members for select to authenticated
  using (public.my_role() = 'admin');

-- 4) 카카오로 처음 로그인하면 '승인대기' 행 자동 생성 -------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.members (user_id, kakao_nickname)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name',
             new.raw_user_meta_data->>'nickname',
             new.raw_user_meta_data->>'preferred_username',
             new.raw_user_meta_data->>'full_name')
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 이미 로그인해 본 계정이 있다면 행 보충
insert into public.members (user_id, kakao_nickname)
select u.id, coalesce(u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'nickname',
                      u.raw_user_meta_data->>'preferred_username', u.raw_user_meta_data->>'full_name')
from auth.users u
where not exists (select 1 from public.members m where m.user_id = u.id);

-- 5) 가입 화면: 아직 아무도 고르지 않은 선수 목록 ----------------------------
create or replace function public.claimable_players()
returns table (id bigint, name text, number int, birth_missing boolean)
language sql stable security definer set search_path = public as $$
  select p.id::bigint, p.name, p.number::int, (p.birth_date is null)
  from public.players p
  where auth.uid() is not null
    and not exists (select 1 from public.members m where m.player_id = p.id)
  order by p.name
$$;

-- 6) 가입 신청 -------------------------------------------------------------
create or replace function public.request_membership(p_player_id bigint, p_birth date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception '선수를 찾을 수 없어요';
  end if;
  if exists (select 1 from public.members where player_id = p_player_id and user_id <> auth.uid()) then
    raise exception '이미 다른 계정이 선택한 선수예요';
  end if;
  update public.members
     set player_id = p_player_id, requested_birth = p_birth, requested_at = now()
   where user_id = auth.uid() and role = 'pending';
  if not found then raise exception '이미 승인됐거나 회원 정보가 없어요'; end if;
end $$;

-- 7) 관리자: 회원 목록 / 승인·권한 변경 / 반려 ------------------------------
create or replace function public.list_members()
returns table (user_id uuid, kakao_nickname text, player_id bigint, player_name text,
               requested_birth date, birth_date date, role text,
               requested_at timestamptz, approved_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception '관리자만 볼 수 있어요'; end if;
  return query
    select m.user_id, m.kakao_nickname, m.player_id::bigint, p.name,
           m.requested_birth, p.birth_date, m.role, m.requested_at, m.approved_at
    from public.members m
    left join public.players p on p.id = m.player_id
    order by (m.role = 'pending') desc, m.requested_at desc nulls last, m.created_at desc;
end $$;

create or replace function public.approve_member(p_user uuid, p_role text default 'member')
returns void language plpgsql security definer set search_path = public as $$
declare v_player bigint; v_birth date;
begin
  if public.my_role() <> 'admin' then raise exception '관리자만 할 수 있어요'; end if;
  if p_role not in ('member','staff','admin') then raise exception '잘못된 권한이에요'; end if;
  select player_id, requested_birth into v_player, v_birth from public.members where user_id = p_user;
  if not found then raise exception '회원을 찾을 수 없어요'; end if;
  if v_player is null then raise exception '선수를 선택하지 않은 신청이에요'; end if;
  update public.members
     set role = p_role, approved_at = coalesce(approved_at, now())
   where user_id = p_user;
  -- 선수 생일이 비어 있으면 신청한 생일 반영 (이미 있는 값은 덮어쓰지 않음)
  if v_birth is not null then
    update public.players set birth_date = v_birth where id = v_player and birth_date is null;
  end if;
end $$;

create or replace function public.reject_member(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception '관리자만 할 수 있어요'; end if;
  if p_user = auth.uid() then raise exception '본인 계정은 반려할 수 없어요'; end if;
  delete from auth.users where id = p_user;   -- members 행은 cascade 로 함께 삭제
end $$;

-- 8) 탈퇴: 경기 기록과 이름은 남기고, 이름 외 개인정보(생일·사진)와 계정 삭제 --
create or replace function public.withdraw_me()
returns void language plpgsql security definer set search_path = public as $$
declare v_player bigint;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select player_id into v_player from public.members where user_id = auth.uid();
  if v_player is not null then
    update public.players set birth_date = null, photo_url = null where id = v_player;
  end if;
  delete from auth.users where id = auth.uid();
end $$;

-- 9) 함수 실행 권한: 로그인한 사용자만 -------------------------------------
revoke all on function public.claimable_players()          from public, anon;
revoke all on function public.request_membership(bigint, date) from public, anon;
revoke all on function public.list_members()               from public, anon;
revoke all on function public.approve_member(uuid, text)   from public, anon;
revoke all on function public.reject_member(uuid)          from public, anon;
revoke all on function public.withdraw_me()                from public, anon;
grant execute on function public.claimable_players()          to authenticated;
grant execute on function public.request_membership(bigint, date) to authenticated;
grant execute on function public.list_members()               to authenticated;
grant execute on function public.approve_member(uuid, text)   to authenticated;
grant execute on function public.reject_member(uuid)          to authenticated;
grant execute on function public.withdraw_me()                to authenticated;

-- 10) 첫 관리자 지정 (카카오로 한 번 로그인한 뒤, 본인 닉네임으로 실행) --------
-- select user_id, kakao_nickname, role from public.members;   -- 먼저 확인
-- update public.members set role = 'admin', approved_at = now() where kakao_nickname = '여기에_내_카카오_닉네임';
