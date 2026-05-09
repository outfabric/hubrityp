import { checkCsvDuplicates, importPatientsCsv } from './actions';
import { CsvImportFlow } from './csv-import-flow';

/**
 * Server Component page for importing patients from CSV.
 *
 * Renders the h1 title and delegates the multi-step flow (upload -> mapping
 * -> preview -> confirm) to the CsvImportFlow client component.
 */
export default function ImportarPacientesPage() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <h1
        className="text-text-primary mb-8 text-[28px] leading-[1.25] font-semibold"
        data-testid="import-patients-page-title"
      >
        Importar pacientes
      </h1>

      <CsvImportFlow checkDuplicatesAction={checkCsvDuplicates} importAction={importPatientsCsv} />
    </div>
  );
}
