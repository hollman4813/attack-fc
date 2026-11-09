-- ATTACK F.C. 경기 참석 여부 투표 (로그인 회원용)
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run. (members.sql 을 먼저 실행한 상태여야 해요)
-- 여러 번 실행해도 안전합니다.

create table if not exists public.match_rsvp (
  match_id   bigint not null,
  player_id  bigint not null,
  status     text   not null check (status in ('yes','no')),
  quarters   int[]  not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (match_id, player_id)
);
alter table public.match_rsvp enable row level security;   -- 정책 없음: 아래 함수로만 접근

-- 내 응답 저장 (승인된 회원 본인 선수 기준)
create or replace function public.save_rsvp(p_match bigint, p_status text, p_quarters int[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_player bigint; v_q int[];
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select player_id into v_player from public.members
   where user_id = auth.uid() and role in ('member','staff','admin');
  if v_player is null then raise exception '승인된 회원만 참석 여부를 등록할 수 있어요'; end if;
  if p_status not in ('yes','no') then raise exception '잘못된 값이에요'; end if;
  v_q := case when p_status = 'yes'
              then coalesce((select array_agg(distinct q order by q) from unnest(p_quarters) q where q between 1 and 4), '{}')
              else '{}' end;
  if p_status = 'yes' and coalesce(array_length(v_q,1),0) = 0 then raise exception '가능한 쿼터를 1개 이상 선택해 주세요'; end if;
  insert into public.match_rsvp (match_id, player_id, status, quarters, updated_at)
  values (p_match, v_player, p_status, v_q, now())
  on conflict (match_id, player_id)
  do update set status = excluded.status, quarters = excluded.quarters, updated_at = now();
end $$;

-- 현황: 승인된 회원 전체 + 응답 (미응답은 status 가 null)
create or replace function public.rsvp_list(p_match bigint)
returns table (player_id bigint, name text, number int, status text, quarters int[], is_me boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  return query
    select p.id::bigint, p.name, p.number::int, r.status, r.quarters,
           (m.user_id = auth.uid())
    from public.members m
    join public.players p on p.id = m.player_id
    left join public.match_rsvp r on r.player_id = p.id and r.match_id = p_match
    where m.role in ('member','staff','admin')
    order by (r.status is null), (r.status = 'no'), p.number nulls last, p.name;
end $$;

revoke all on function public.save_rsvp(bigint, text, int[]) from public, anon;
revoke all on function public.rsvp_list(bigint)              from public, anon;
grant execute on function public.save_rsvp(bigint, text, int[]) to authenticated;
grant execute on function public.rsvp_list(bigint)              to authenticated;
