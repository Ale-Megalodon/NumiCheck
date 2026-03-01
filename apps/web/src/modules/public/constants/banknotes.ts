export type BanknoteOption = {
  denomination: "10" | "20" | "50";
  label: string;
  imageSrc: string;
};

export const BANKNOTE_OPTIONS: BanknoteOption[] = [
  {
    denomination: "10",
    label: "Bs 10",
    imageSrc: "/img/10bs.jpeg"
  },
  {
    denomination: "20",
    label: "Bs 20",
    imageSrc: "/img/20bs.jpeg"
  },
  {
    denomination: "50",
    label: "Bs 50",
    imageSrc: "/img/50bs.jpeg"
  }
];
