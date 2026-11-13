-- 상대팀 엠블럼: 이미지 주소(https://...) 또는 자동 생성 엠블럼 시드(gen:xxxx)
alter table opponents add column if not exists emblem_url text;
notify pgrst, 'reload schema';
