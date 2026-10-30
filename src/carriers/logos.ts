// Logos supplied by the shop owner, bundled with the app. Every carrier has one; a tile
// falls back to letters only if a file is missing.
import ecpay from "../assets/carriers/ecpay.png";
import family from "../assets/carriers/family.png";
import hct from "../assets/carriers/hct.png";
import post from "../assets/carriers/post.png";
import seven from "../assets/carriers/seven.png";
import shopee from "../assets/carriers/shopee.png";
import tcat from "../assets/carriers/tcat.png";

export const CARRIER_LOGOS: Readonly<Record<string, string>> = {
  ecpay,
  family,
  hct,
  post,
  seven,
  shopee,
  tcat,
};
