# Data Directory

## cid10-source.csv

CID-10 (International Classification of Diseases, 10th Revision) subcategory codes from the Brazilian Ministry of Health (Datasus).

**Format:** UTF-8, semicolon-delimited, two columns: `CODIGO;DESCRICAO`

**Row count:** ~12,451 entries (all subcategories + categories without subcategories)

**Source:** Datasus CID-10 Tabular Data (CID-10-SUBCATEGORIAS.CSV from the CID10CSV.ZIP distribution)

- Download page: http://www2.datasus.gov.br/cid10/V2008/download.htm
- File description: http://www2.datasus.gov.br/cid10/V2008/descrcsv.htm
- Raw file: https://raw.githubusercontent.com/cleytonferrari/CidDataSus/master/CIDImport/Repositorio/Resources/CID-10-SUBCATEGORIAS.CSV

**License:** Public domain. Brazilian government open data published by the Ministry of Health through Datasus. The CID-10 tabular data is freely available for use without restrictions per Brazilian open data policy (Lei 12.527/2011 - Lei de Acesso a Informacao).

**Processing:** The original Datasus file (ISO-8859-1, 8 columns) was converted to UTF-8 and simplified to the two-column `CODIGO;DESCRICAO` format. Subcategory codes were normalized to dot notation (e.g., `A000` -> `A00.0`). See `scripts/build-cid10-data.ts` for the build pipeline that converts this CSV into the application's JSON format.

**Update cadence:** Datasus publishes CID-10 updates approximately once per year. To update, download the latest CID-10-SUBCATEGORIAS.CSV, run the same transformation, replace this file, and re-run `npx tsx scripts/build-cid10-data.ts`.
