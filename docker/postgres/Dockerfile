# Postgres 17 with every extension Zekra's schema creates: vchord, vchord_bm25 and pg_tokenizer
# (VectorChord suite, based on the official postgres image) plus pg_partman from PGDG.
FROM tensorchord/vchord-suite:pg17-latest
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17-partman \
 && rm -rf /var/lib/apt/lists/*
CMD ["postgres", "-c", "shared_preload_libraries=vchord,pg_tokenizer"]
