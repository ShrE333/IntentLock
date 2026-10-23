import type {IntentWallet,WalletEvaluation} from '../wallets/types';
import type {CommerceProduct} from './types';
export function restrictCatalogEvaluation(wallet:IntentWallet,product:CommerceProduct,evaluation:WalletEvaluation):WalletEvaluation{
 const violations=[...evaluation.violations],reasons=[...evaluation.reasons];
 if(!product.discovery?.available){violations.push('CATALOG_UNAVAILABLE');reasons.push('The exact variant is unavailable.');}
 // Catalog brand/features/categories have no independently verified hard-policy provenance.
 // Missing brand cannot be assumed outside the wallet's blocked-brand set.
 if(wallet.blockedBrands.length||wallet.allowedBrands.length){violations.push('CATALOG_BRAND_UNVERIFIED');reasons.push('Unknown brand cannot satisfy an allowlist or clear a blocked-brand restriction.');}
 if(wallet.allowedCategories.length){violations.push('CATALOG_CATEGORY_UNVERIFIED');reasons.push('Catalog category has no independently established hard-policy provenance.');}
 if(wallet.requiredFeatures.length){violations.push('CATALOG_FEATURES_UNVERIFIED');reasons.push('Inferred catalog features cannot satisfy required wallet features.');}
 return {...evaluation,...(violations.length?{decision:'BLOCK' as const,requiresHumanApproval:false}:{}),violations,reasons,canAutoExecute:false};
}
