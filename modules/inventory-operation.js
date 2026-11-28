export function createInventoryOperation(send, newId = () => crypto.randomUUID()) {
  let pending;
  let running = false;

  return async (fields, upload) => {
    if (running) return { busy: true };
    running = true;
    try {
      const fingerprint = JSON.stringify(fields);
      if (!pending || pending.fingerprint !== fingerprint) {
        pending = { id: newId(), fingerprint, receipt: undefined };
      }
      // Preserve the exact uploaded path and operation ID on an interrupted retry.
      if (pending.receipt === undefined) pending.receipt = await upload();
      const result = await send({
        ...fields.payload,
        p_operation_id: pending.id,
        p_receipt_reference: pending.receipt
      });
      if (!result.error) pending = null;
      return result;
    } finally {
      running = false;
    }
  };
}
