const REQUIRED_WORD = "seguro";

export function confirmRangeEdit(actionLabel: string): boolean {
  for (let step = 1; step <= 3; step += 1) {
    const input = window.prompt(
      `${actionLabel}\nConfirmacion ${step}/3: escribe "${REQUIRED_WORD}" para continuar.`
    );

    if (input === null) {
      return false;
    }

    if (input.trim().toLowerCase() !== REQUIRED_WORD) {
      window.alert(`Accion cancelada. Debes escribir "${REQUIRED_WORD}" exactamente.`);
      return false;
    }
  }

  return true;
}

