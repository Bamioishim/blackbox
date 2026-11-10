import type { Metadata } from "next";
import MarketplaceClient from "./MarketplaceClient";
export const metadata:Metadata={title:"Marketplace & Portfolio | Blackbox"};
export default function MarketplacePage(){return <MarketplaceClient/>;}
