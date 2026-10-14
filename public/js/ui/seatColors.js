// Eight numbered seat colours; numbering remains the primary identifier.
export const SEAT_HUES = Object.freeze([162, 196, 38, 280, 12, 225, 320, 85]);
export const seatHue = (seat) => SEAT_HUES[((seat | 0) % SEAT_HUES.length + SEAT_HUES.length) % SEAT_HUES.length];
