'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { LocationCard, type LocationCardData } from '@/modules/agenda/components/location-card';
import { LocationDeleteDialog } from '@/modules/agenda/components/location-delete-dialog';
import { LocationFormModal } from '@/modules/agenda/components/location-form-modal';
import { LocationsEmptyState } from '@/modules/agenda/components/locations-empty-state';
import { Button } from '@/shared/ui/button';

import { createLocation, deleteLocation, setLocationDefault, updateLocation } from './actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LocationsPageClientProps {
  locations: LocationCardData[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client-side orchestrator for the locations page.
 *
 * Manages the form modal, delete dialog, and "set as default" action.
 * After any mutation, refreshes the Server Component data via `router.refresh()`.
 */
export function LocationsPageClient({ locations }: LocationsPageClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Form modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<LocationCardData | null>(null);

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingLocation, setDeletingLocation] = useState<LocationCardData | null>(null);

  // Handlers
  const handleAdd = useCallback(() => {
    setEditingLocation(null);
    setFormOpen(true);
  }, []);

  const handleEdit = useCallback((location: LocationCardData) => {
    setEditingLocation(location);
    setFormOpen(true);
  }, []);

  const handleDeleteClick = useCallback((location: LocationCardData) => {
    setDeletingLocation(location);
    setDeleteOpen(true);
  }, []);

  const handleSetDefault = useCallback(
    (locationId: string) => {
      startTransition(async () => {
        const result = await setLocationDefault(locationId);
        if (result.ok) {
          toast.success('Local marcado como padrao.');
          router.refresh();
        } else {
          toast.error('Erro ao marcar local como padrao.');
        }
      });
    },
    [router],
  );

  const handleMutationSuccess = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingLocation) return { ok: false as const, error: 'not_found' as const };
    return deleteLocation(deletingLocation.id);
  }, [deletingLocation]);

  // Render
  if (locations.length === 0) {
    return (
      <>
        <LocationsEmptyState onAdd={handleAdd} />
        <LocationFormModal
          open={formOpen}
          onOpenChange={setFormOpen}
          location={editingLocation}
          onCreate={createLocation}
          onUpdate={(id, input) => updateLocation(id, input)}
          onSuccess={handleMutationSuccess}
        />
      </>
    );
  }

  return (
    <>
      {/* Add button */}
      <div className="mb-6 flex justify-end">
        <Button onClick={handleAdd} data-testid="add-location-btn">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Adicionar local
        </Button>
      </div>

      {/* Location cards */}
      <div className="grid gap-4">
        {locations.map((location) => (
          <LocationCard
            key={location.id}
            location={location}
            onEdit={handleEdit}
            onSetDefault={handleSetDefault}
            onDelete={handleDeleteClick}
          />
        ))}
      </div>

      {/* Form modal */}
      <LocationFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        location={editingLocation}
        onCreate={createLocation}
        onUpdate={(id, input) => updateLocation(id, input)}
        onSuccess={handleMutationSuccess}
      />

      {/* Delete dialog */}
      {deletingLocation && (
        <LocationDeleteDialog
          locationName={deletingLocation.name}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onConfirm={handleDeleteConfirm}
          onSuccess={handleMutationSuccess}
        />
      )}
    </>
  );
}
