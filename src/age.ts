export function ageInMonthsAt(
  birthDate: string,
  evaluationDate: Date
): number {
  const birth = new Date(birthDate);

  if (Number.isNaN(birth.getTime())) {
    throw new Error(`Invalid birthDate: ${birthDate}`);
  }

  let months =
    (evaluationDate.getFullYear() - birth.getFullYear()) * 12 +
    (evaluationDate.getMonth() - birth.getMonth());

  if (evaluationDate.getDate() < birth.getDate()) {
    months -= 1;
  }

  return Math.max(0, months);
}