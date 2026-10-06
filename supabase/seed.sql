-- Initial branch shortlist. Confirm locations and official source pages before live release.
insert into public.stores(name,address,latitude,longitude,source_url) values
('Loblaws Queen West','585 Queen St W',43.6475,-79.4021,'https://www.loblaws.ca/'),
('Farm Boy Bathurst','29 Bathurst St',43.6405,-79.4024,'https://www.farmboy.ca/'),
('Longo’s Maple Leaf Square','15 York St',43.6424,-79.3816,'https://www.longos.com/'),
('FreshCo Bathurst','410 Bathurst St',43.6533,-79.4060,'https://freshco.com/'),
('Metro College Park','444 Yonge St',43.6605,-79.3832,'https://www.metro.ca/'),
('Loblaws Carlton','60 Carlton St',43.6615,-79.3797,'https://www.loblaws.ca/')
on conflict(name,address) do nothing;
