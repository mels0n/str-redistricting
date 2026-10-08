import { DataError } from '../errors/index.js';

/**
 * Pinned SHA-256 of every Census Bureau file the generator and the publish step read, keyed by file name.
 * The maps are only reproducible from these exact bytes. The tabblock files are the 2020 TIGER block
 * shapefiles for the 50 states; the cb_ files are the display-only cartographic boundaries. The Census
 * Bureau can reissue a file without notice, so a mismatch means the maps would change: do not edit a value
 * here without regenerating and re-reviewing every map that reads the file.
 */
export const CENSUS_SHA256: Readonly<Record<string, string>> = {
  'cb_2020_us_county_20m.zip': '9394913edbd6f72791b06b84509e59ea2d275d10b73ae27ef87df3bdb061890c',
  'cb_2020_us_state_500k.zip': 'dcc877984a3e4d59c1ee8d068b6681517c545e0c1827b7e78a7c2c7cbb167da6',
  'cb_2024_us_cd119_500k.zip': '2b4238aed7e865df75d0c9cfcd8dffa1b79007b24519ecc4b213e683078b031a',
  'cb_2025_us_cd119_500k.zip': '8e804518d333d67e24e25c61767c6a7c78fd0a0852179e8cc19c36fd66011010',
  'cb_2025_us_state_20m.zip': '9340b6d995e971b2b4230518f4fa85e6cd9e7fe6811afabc90a6a8b1191530f6',
  'tl_2020_01_tabblock20.zip': '5d228872ccc680374631c1c71db6b7c362dc98e782ee3c4db111aa651df48468',
  'tl_2020_02_tabblock20.zip': '6fe96f3a8bbaf78945ee3a3897264ed74f1b72bc0cb46ffd434039729dccf493',
  'tl_2020_04_tabblock20.zip': '206e94e94cf4b5ea30cf286f6569c4de697ba454659cac7252224e5c5d2c4703',
  'tl_2020_05_tabblock20.zip': '5b330f40bf913349b428e8b19bba46bc6e2fef24b78393f8477b5b96870fe6e8',
  'tl_2020_06_tabblock20.zip': '154ffb979e4d1f8cae4ff2676cbba9030ef39a92d4620644bc8aa7f7be2ad85f',
  'tl_2020_08_tabblock20.zip': '708f5ecde530a9e8d6ed10be4cfbf6d9bac3fcdf26498b7546973503de38d4b4',
  'tl_2020_09_tabblock20.zip': 'a935a5a85717389ded782debd15d7019705d7fc0777548d22cc09552208ac6b1',
  'tl_2020_10_tabblock20.zip': 'de20500a99debb0d5da4d12f5327fb847265656472a64fe656603cc90b9993da',
  'tl_2020_12_tabblock20.zip': 'ce5d7a02e47df17dadfa9c889edb6d35a89dfb520b8669bc4d302c2c0e100418',
  'tl_2020_13_tabblock20.zip': '089bf2763209a553aa3e8223dd2529d6fbbb319e2e115fcc32a8094179d362ac',
  'tl_2020_15_tabblock20.zip': 'c29683118cd7eada4bd4672e30de6bdd5638a752c1d0f7f795b4dd580c02259e',
  'tl_2020_16_tabblock20.zip': 'b3a9aaf37fff885173a51135dd81cc85fc135ff4af3aa0d01aa12adac1d82531',
  'tl_2020_17_tabblock20.zip': '6d6b91c73cd89295e11aefc492ffec8e9dac7456a5023b85fe9953fa33c0b243',
  'tl_2020_18_tabblock20.zip': 'be7384a1bb8b7626b5386659bfeb0811ab69a6e5ca98c78d7e67a280ecdee2d9',
  'tl_2020_19_tabblock20.zip': '8c63755fc5b6c825e1c3ce4f6f4cbbd379fb6a75cdc7297ebc677eab5a7423cd',
  'tl_2020_20_tabblock20.zip': 'a0ccda5300d1994008b51bf345c77bc1b04adc8df6219b226c64b80d3a611198',
  'tl_2020_21_tabblock20.zip': 'ebed3b0de6fee945db0064d378aa66aaebe05f05b460a5ad109a57a14a783b66',
  'tl_2020_22_tabblock20.zip': 'cd051604d53f3cf2f33e32e9dba042c24604b808e840c7cd1e22ea3d05291bd7',
  'tl_2020_23_tabblock20.zip': '0570b36a68b14f08ba23eb69d44f48b03c2c7e40e7cb6c3a0df0bdc5b3dc5d05',
  'tl_2020_24_tabblock20.zip': '152395105863f058c32dbfd8321e8c0f364be1e4b115d38ccf6940cfce1f4990',
  'tl_2020_25_tabblock20.zip': '06fc2e4c3249cbe253981cb9056d7f71f9d9a56e91b680481101caed9165e1d3',
  'tl_2020_26_tabblock20.zip': 'f14f1508e8a2921d1f660b095be7160db43c9bb95a41b9494876d09928885fba',
  'tl_2020_27_tabblock20.zip': 'dbf8b8ad633e60e3ec4008611293ed298e4b7fb64ab5a1bdbe7d8ade4944228d',
  'tl_2020_28_tabblock20.zip': '1e0429794dd7022ba8e82b0cd158fb4414920852473c1c05bd7b461eb2211997',
  'tl_2020_29_tabblock20.zip': '555aa3e4ed39934cb7560050c873307d71a6e7e4b345995e17004cf87a5d9e66',
  'tl_2020_30_tabblock20.zip': 'a7c9520270277e905ea6c6eec85f64bd205a9889e6275b535679f723d21cdbf0',
  'tl_2020_31_tabblock20.zip': '5f5469ae3c3a461a3b5f7473d414fdaaedde32ad8c3f14fb25f2664c8970493a',
  'tl_2020_32_tabblock20.zip': 'cd7cdd59ecea5419953c988aa69008999e50760bb0fa3395a88c0c85538cad06',
  'tl_2020_33_tabblock20.zip': '253ef035968da2645e24effd91570cf7d091575782783840d0a4f0dbd9c63038',
  'tl_2020_34_tabblock20.zip': '33e5475f232d0f01c6a6448fb041fc38bd23eee1f8f5f5a2878cfb116690ce88',
  'tl_2020_35_tabblock20.zip': 'cf3a71e48ec3bcbd1e415d3b5698721701a8a46690a96d14d3724d264f7f3f55',
  'tl_2020_36_tabblock20.zip': 'b8fa7fac0cad83c378778fb07f1d2487e27eedb1a5d29e5c59cda70155c3de93',
  'tl_2020_37_tabblock20.zip': 'a9b5398902ddcb68906d39c1a5354134eb81c86fd0a5e2f425c7f4da7eec6893',
  'tl_2020_38_tabblock20.zip': '3692c87bfb834dd4dd4cd1580f11648b9cfc92a996d2b1524e8ee4da94f88156',
  'tl_2020_39_tabblock20.zip': '8075876e141b74dbaa93f42e56ef471e4070d2ad6ae1fef333e1edfaff47515e',
  'tl_2020_40_tabblock20.zip': '7b0445a7d613eab02e378b50326bf3e69c8f53cf7851a0a0ad4b1c2c40490f45',
  'tl_2020_41_tabblock20.zip': '2a057daf7185823ff5d5195c82f91a984a5d68c2fa4e785ff90f2dc111bad283',
  'tl_2020_42_tabblock20.zip': '16f3cd1f7674fba685e1810ab7f66f523cd185d8ad4a7259632db13b91feef3d',
  'tl_2020_44_tabblock20.zip': '79d10c9dfec1e3e0962e13d6295b53856db286a156d9937d3737adb0c542f35b',
  'tl_2020_45_tabblock20.zip': '87ac54c63173ad2e3cd2cad03e10e97371646772e6b0026a51e6e413db49ae57',
  'tl_2020_46_tabblock20.zip': 'a5f28c340d5b1248f5c00197a2cebd945692a302e43928e40ce4f04f494baeb8',
  'tl_2020_47_tabblock20.zip': '26e1045a27944d21c759a61f5022c0acf41a724bb8d89a41ffb1ff377de69118',
  'tl_2020_48_tabblock20.zip': 'c0e71f4bf463c2126e8fc3635eadc1465235e19c7fa45468606e3bcdfa989205',
  'tl_2020_49_tabblock20.zip': '79b0c3dd1c9e3eee3d5300628b18d4aa8e347f1025f9b2f52240dd41ff8b5ecf',
  'tl_2020_50_tabblock20.zip': '7ffc06ba34d211ac92c933b500a095a5bb3abdfb8266555f4c5935fba16c5c78',
  'tl_2020_51_tabblock20.zip': '5722c3a80c66acb087429ea511a47d05a742a7b99712a63a711014fca5be9d61',
  'tl_2020_53_tabblock20.zip': '0ccdbb2b58d4cdc083097411d791ba7a61e599f0937073187617f76740c61689',
  'tl_2020_54_tabblock20.zip': '04e931a5d288ed62da3b947239f3f23f8b6a8d8b4a749ec749eb90158b50f863',
  'tl_2020_55_tabblock20.zip': '22aa5a4c584f9a0ecea1284bb41c22b8931c4048f7158dedf4800b68dfc1ed1f',
  'tl_2020_56_tabblock20.zip': '75a47db914c4cf3fb4d5b9c07556054f268a0c901749a98ecc93f80fceb6bfa2',
};

/** The pinned hash for `fileName`, or a DataError when the file is not in the manifest (never a silent pass). */
export function pinnedSha256(fileName: string): string {
  const pinned = Object.hasOwn(CENSUS_SHA256, fileName) ? CENSUS_SHA256[fileName] : undefined;
  if (pinned === undefined) {
    throw new DataError(`${fileName}: not in the pinned Census manifest (src/server/shared/config/census-manifest.ts), so its sha256 cannot be checked`);
  }
  return pinned;
}
