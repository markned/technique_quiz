type RestartConfirmDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function RestartConfirmDialog({ open, onCancel, onConfirm }: RestartConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="confirm-backdrop" role="dialog" aria-modal="true">
      <div className="confirm-dialog">
        <h4>Начать заново?</h4>
        <p>Текущий прогресс по раундам будет сброшен.</p>
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            Начать заново
          </button>
        </div>
      </div>
    </div>
  );
}
