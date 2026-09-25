-- Mesma régua de creator_niche, com uma única avaliação do nicho dominante.
-- O planner expandia o CTE top em cada braço do CASE de território, repetindo
-- a leitura/descompressão de brand_history e o sort dos nichos por creator.
-- MATERIALIZED calcula id, handle, nicho_raw e pct_dom uma vez; não muda
-- cortes, regexes, benchmarks, campos, privilégios ou o security_invoker.
create or replace view public.creator_niche
with (security_invoker = true)
as
WITH top AS MATERIALIZED (
         SELECT c.id,
            c.handle,
            lower(( SELECT n.value ->> 'nicho'::text
                   FROM jsonb_array_elements(c.brand_history -> 'nichos'::text) n(value)
                  ORDER BY ((n.value ->> 'pct'::text)::numeric) DESC
                 LIMIT 1)) AS nicho_raw,
            ( SELECT max((n.value ->> 'pct'::text)::numeric) AS max
                   FROM jsonb_array_elements(c.brand_history -> 'nichos'::text) n(value)) AS pct_dom
           FROM creators c
          WHERE c.brand_history ? 'nichos'::text
        ), bucket AS (
         SELECT top.id,
            top.handle,
            top.pct_dom,
            top.nicho_raw,
                CASE
                    WHEN top.nicho_raw ~ 'cabelo|cacho|penteado|capilar|ruiv|corte'::text THEN 'cabelo'::text
                    WHEN top.nicho_raw ~ 'maquiag|make'::text THEN 'maquiagem'::text
                    WHEN top.nicho_raw ~ 'skincare|pele|skin|dermo|antienvelhec|anti-?idade|rejuven'::text THEN 'skincare'::text
                    WHEN top.nicho_raw ~ 'unha|nail'::text THEN 'unhas'::text
                    WHEN top.nicho_raw ~ 'perfum|fragr'::text THEN 'perfume'::text
                    WHEN top.nicho_raw ~ 'c[íi]lio|sobrancelh|lash'::text THEN 'cilios'::text
                    WHEN top.nicho_raw ~ 'est[ée]tic|harmoniz|botox|preenchiment'::text THEN 'estetica'::text
                    ELSE 'outros'::text
                END AS niche_bucket
           FROM top
        ), eng AS (
         SELECT b.id,
            b.handle,
            b.pct_dom,
            b.nicho_raw,
            b.niche_bucket,
            s.eng_rate
           FROM bucket b
             LEFT JOIN LATERAL ( SELECT snapshots.eng_rate
                   FROM snapshots
                  WHERE snapshots.creator_id = b.id AND snapshots.eng_rate IS NOT NULL
                  ORDER BY snapshots.captured_at DESC
                 LIMIT 1) s ON true
        ), bench AS (
         SELECT eng.niche_bucket,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (eng.eng_rate::double precision)) AS eng_mediana,
            count(*) AS n_nicho
           FROM eng
          WHERE eng.eng_rate IS NOT NULL AND eng.niche_bucket <> 'outros'::text
          GROUP BY eng.niche_bucket
        )
 SELECT e.id,
    e.handle,
    e.niche_bucket,
    e.pct_dom,
    e.eng_rate,
    bn.eng_mediana,
    e.niche_bucket <> 'outros'::text AND e.pct_dom >= 70::numeric AND e.eng_rate IS NOT NULL AND bn.eng_mediana IS NOT NULL AND e.eng_rate::double precision > bn.eng_mediana AS kol_qualifica
   FROM eng e
     LEFT JOIN bench bn USING (niche_bucket);

