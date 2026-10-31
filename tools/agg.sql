SELECT Mk AS mk, Cn AS cn, Ft AS ft, Fm AS fm, [Ec (cm3)] AS ec, [Ep (KW)] AS ep, Ct AS ct,
 SUM(R) AS r, AVG(CAST([M (kg)] AS float)) AS m, AVG(CAST(Fc AS float)) AS fc, AVG(CAST([Ewltp (g/km)] AS float)) AS ew,
 AVG(CAST([Enedc (g/km)] AS float)) AS en, AVG(CAST([E (g/km)] AS float)) AS e0, AVG(CAST([Z (Wh/km)] AS float)) AS z, AVG(CAST([W (mm)] AS float)) AS w, AVG(CAST([At1 (mm)] AS float)) AS at, AVG(CAST(Zr AS float)) AS zr, AVG(CAST(Mt AS float)) AS mt
FROM [CO2Emission].[latest].[TBL] WHERE R > 0 GROUP BY Mk, Cn, Ft, Fm, [Ec (cm3)], [Ep (KW)], Ct
