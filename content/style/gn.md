# Guía — guaraní (avañe'ẽ)

El guaraní de este programa lo escribe o lo aprueba una persona que lo habla.
La app **nunca genera guaraní**: un pedido de texto en `gn` se rechaza, y en
jopara el modelo solo usa las palabras aprobadas en /glossary y las "Palabras
seguras" de `jopara.md` (PLAN-build4 §1.2). El audio en guaraní lo graba una
persona (§1.4).

## Quién escribe
- Textos en guaraní puro: un hablante nativo los escribe o los revisa línea por
  línea antes de publicar. Sin esa revisión no se publica.
- Si una palabra no está aprobada, va en castellano. No se adivina.

## Ortografía (alfabeto oficial)
- Vocales nasales con tilde nasal: ã ẽ ĩ õ ũ ỹ. La y es vocal (ỹ = y nasal).
- g̃ (g con tilde nasal) es una letra propia; no tiene forma precompuesta en
  Unicode, se escribe g + U+0303. Revisá que no se pierda al copiar.
- El puso (oclusión glotal) se escribe con apóstrofo recto: ra'a, mba'e,
  ko'ãga. No lo reemplaces por comillas tipográficas ni lo borres.
- El acento gráfico marca la sílaba tónica cuando no es la última: "ndaikatúi".
- Dígrafos: ch, mb, nd, ng, nt, rr.

## Registros
- `everyday`: lo que se oye en la calle y en casa.
- `kids`: palabras para cuentos y contenido infantil.
- `formal`: textos oficiales o educativos.
- `slang`: muy informal; usar con cuidado y nunca en temas serios.

## Revisión en /glossary
1. Cada palabra entra como `proposed` (a mano, por CSV o con "Importar semilla").
2. Un hablante revisa significado, ejemplo y registro, y marca `approved` o
   `rejected` con su nombre; la fecha queda guardada.
3. Solo `approved` + `jopara_ok` llega al modelo en jopara. Editar el término,
   un significado, el ejemplo o `jopara_ok` lo vuelve a `proposed`.
4. Si tiene `sayAs`, "Enviar a pronunciaciones" crea la respelling para la voz,
   con el mismo estado de revisión.
